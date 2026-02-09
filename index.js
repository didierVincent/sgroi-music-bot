// audio_tracker_bot - Multi-stage Ping + DM + Dry Run Manual Check (JavaScript, ESM)
// -----------------------------------------------------------------------------------

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

/* ------------------------------------------------------------------ */
/* STARTUP SANITY LOG (DO NOT REMOVE – SAVES HOURS LATER)              */
/* ------------------------------------------------------------------ */
console.log('🚀 Booting bot with env:', {
  BOT_TOKEN: process.env.BOT_TOKEN ? 'present' : 'missing',
  TARGET_DAYS: process.env.TARGET_DAYS,
  CHECK_INTERVAL_MINUTES: process.env.CHECK_INTERVAL_MINUTES,
  PORT: process.env.PORT,
});

/* ------------------------------------------------------------------ */
/* Render-safe HTTP server                                             */
/* ------------------------------------------------------------------ */
const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(200);
    res.end('Discord bot running');
  }
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

/* ------------------------------------------------------------------ */
/* Data persistence                                                    */
/* ------------------------------------------------------------------ */
const DATA_FILE = './audioData.json';
let userAudioData = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    userAudioData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
  } catch (err) {
    console.error('⚠️ Failed to parse data file, starting fresh:', err);
    userAudioData = {};
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(userAudioData, null, 2));
}

/* ------------------------------------------------------------------ */
/* Config (defensive parsing)                                          */
/* ------------------------------------------------------------------ */
const TARGET_DAYS = Number(process.env.TARGET_DAYS) || 30;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES) || 60;
const NOTIFY_THRESHOLDS = [7, 3, 1, 0];
const audioExtRe = /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i;

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */
const MESSAGES = {
  7: process.env.NOTIFY_7DAYS || '{user} you have 7 days or less left to post a track! 💣 {duedate}',
  3: process.env.NOTIFY_3DAYS || '{user}! ⚠️ Few days left! Post music! 🥺 {duedate}',
  1: process.env.NOTIFY_1DAY || '😱 {user}!!! 1 day left to post music! QUICK send something 🙏',
  0: process.env.NOTIFY_OVERDUE || "🚨🚨🚨 {user}!!!!! It's been over a month of no music! 😳😳😳",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function isAudioAttachment(att) {
  return Boolean(att?.name && audioExtRe.test(att.name.trim()));
}

/* ------------------------------------------------------------------ */
/* Discord client                                                      */
/* ------------------------------------------------------------------ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

/* ------------------------------------------------------------------ */
/* Core logic                                                          */
/* ------------------------------------------------------------------ */
async function checkAndNotify() {
  const now = Date.now();

  for (const [guildId, channels] of Object.entries(userAudioData)) {
    for (const [channelId, users] of Object.entries(channels)) {
      for (const [userId, data] of Object.entries(users)) {
        const lastAudio = data.lastAudio || 0;
        const daysLeft = TARGET_DAYS - (now - lastAudio) / 86400000;

        const threshold = [...NOTIFY_THRESHOLDS].reverse().find(t => daysLeft <= t);
        if (threshold === undefined || data.lastNotifiedThreshold === threshold) continue;

        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
          if (!member) continue;

          const dueDateStr = new Date(lastAudio + TARGET_DAYS * 86400000).toLocaleDateString(
            'en-AU',
            { weekday: 'short', day: 'numeric', month: 'short' }
          );

          const msgText = MESSAGES[threshold]
            .replace('{user}', member.toString())
            .replace('{duedate}', dueDateStr);

          try { await member.send(msgText); } catch {}
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel?.isTextBased?.()) await channel.send(msgText);

          data.lastNotifiedThreshold = threshold;
          saveData();

          console.log(`📩 Notified ${member.user.tag} (${threshold}-day)`);
        } catch (err) {
          console.error('Notify error:', err);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Seeding                                                            */
/* ------------------------------------------------------------------ */
async function runSeedOnChannel(channel, maxFetch = 300) {
  let lastId = null;
  let totalFetched = 0;
  const userLatest = new Map();

  while (true) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;

    const messages = await channel.messages.fetch(opts);
    if (!messages.size) break;

    totalFetched += messages.size;

    for (const msg of messages.values()) {
      if (msg.author.bot || !msg.attachments.size) continue;
      if (![...msg.attachments.values()].some(isAudioAttachment)) continue;

      const uid = msg.author.id;
      if (!userLatest.has(uid) || msg.createdTimestamp > userLatest.get(uid)) {
        userLatest.set(uid, msg.createdTimestamp);
      }
    }

    lastId = messages.last()?.id;
    if (totalFetched >= maxFetch) break;
  }

  const gid = channel.guild.id;
  const cid = channel.id;
  userAudioData[gid] ??= {};
  userAudioData[gid][cid] ??= {};

  for (const [uid, ts] of userLatest.entries()) {
    userAudioData[gid][cid][uid] = {
      lastAudio: ts,
      lastNotifiedThreshold: userAudioData[gid][cid][uid]?.lastNotifiedThreshold ?? null,
    };
  }

  saveData();
  return { fetchedUsers: userLatest.size, totalFetched };
}

/* ------------------------------------------------------------------ */
/* Commands                                                           */
/* ------------------------------------------------------------------ */
client.on('messageCreate', async (message) => {
  if (!message.guild || !message.content.startsWith('!')) return;

  const [cmd, arg] = message.content.slice(1).split(/\s+/);

  if (cmd === 'check') {
    await message.channel.send('🔄 Updating recent audio posts...');
    const result = await runSeedOnChannel(message.channel, 300);
    await message.channel.send(`✅ Updated ${result.fetchedUsers} users from ${result.totalFetched} messages.`);
  }

  if (cmd === 'testping') {
    await message.channel.send('🧪 Running test notification simulation...');
    await checkAndNotify();
    await message.channel.send('✅ Test complete.');
  }
});

/* ------------------------------------------------------------------ */
/* Ready + scheduler                                                  */
/* ------------------------------------------------------------------ */
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  setTimeout(() => {
    checkAndNotify();
    setInterval(checkAndNotify, CHECK_INTERVAL_MINUTES * 60 * 1000);
  }, 10_000);
});

/* ------------------------------------------------------------------ */
/* Login                                                              */
/* ------------------------------------------------------------------ */
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing — cannot start bot');
  process.exit(1);
}

client.login(process.env.BOT_TOKEN)
  .then(() => console.log('🔑 client.login() resolved'))
  .catch(err => {
    console.error('❌ Discord login failed:', err);
    process.exit(1);
  });
