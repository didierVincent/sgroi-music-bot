// audio_tracker_bot - Fixed Version (JavaScript, ESM)
// ---------------------------------------------------

import { Client, GatewayIntentBits, Events } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

/* ------------------------------------------------------------------ */
/* STARTUP SANITY LOG                                                  */
/* ------------------------------------------------------------------ */
console.log('🚀 Boot sequence start');
console.log('🔍 ENV CHECK:', {
  BOT_TOKEN: process.env.BOT_TOKEN ? 'present' : '❌ MISSING',
  TARGET_DAYS: process.env.TARGET_DAYS,
  CHECK_INTERVAL_MINUTES: process.env.CHECK_INTERVAL_MINUTES,
  PORT: process.env.PORT,
  NODE_VERSION: process.version,
});

/* ------------------------------------------------------------------ */
/* HARD FAIL IF TOKEN MISSING                                          */
/* ------------------------------------------------------------------ */
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing — aborting immediately');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* HTTP server (for uptime checks)                                     */
/* ------------------------------------------------------------------ */
const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(req.url === '/health' ? 'ok' : 'Discord bot running');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

/* ------------------------------------------------------------------ */
/* Data persistence                                                    */
/* ------------------------------------------------------------------ */
const DATA_FILE = './audioData.json';
let userAudioData = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    userAudioData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    console.log('💾 Loaded audioData.json:', JSON.stringify(userAudioData, null, 2));
  } else {
    console.log('💾 No data file found, starting fresh');
  }
} catch (err) {
  console.error('⚠️ Failed to load data file, resetting:', err);
  userAudioData = {};
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(userAudioData, null, 2));
  } catch (err) {
    console.error('❌ Failed to save data:', err);
  }
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const TARGET_DAYS = Number(process.env.TARGET_DAYS) || 30;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES) || 60;
const NOTIFY_THRESHOLDS = [7, 3, 1, 0];
const audioExtRe = /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i;

console.log('⚙️ Config loaded:', {
  TARGET_DAYS,
  CHECK_INTERVAL_MINUTES,
  NOTIFY_THRESHOLDS,
});

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */
const MESSAGES = {
  7: process.env.NOTIFY_7DAYS || '{user} you have 7 days or less left to post a track! 💣 {duedate}',
  3: process.env.NOTIFY_3DAYS || '{user}! ⚠️ Few days left! Post music! 🥺 {duedate}',
  1: process.env.NOTIFY_1DAY || '😱 {user}!!! 1 day left to post music! QUICK send something 🙏',
  0: process.env.NOTIFY_OVERDUE || "🚨🚨🚨 {user}!!!!! It's been over a month of no music! 😳😳😳",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function isAudioAttachment(att) {
  return Boolean(att?.name && audioExtRe.test(att.name.trim()));
}

/* ------------------------------------------------------------------ */
/* Discord client                                                      */
/* ------------------------------------------------------------------ */
console.log('🤖 Creating Discord client…');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

console.log('✅ Discord client constructed');

/* ------------------------------------------------------------------ */
/* Low-level Discord event logging                                      */
/* ------------------------------------------------------------------ */
client.on(Events.Debug, msg => console.log('🟣 DEBUG:', msg));
client.on(Events.Warn, msg => console.warn('🟡 WARN:', msg));
client.on(Events.Error, err => console.error('🔴 CLIENT ERROR:', err));

client.on(Events.ShardDisconnect, (event, id) => console.error(`🔌 Shard ${id} disconnected`, event));
client.on(Events.ShardReconnecting, id => console.log(`🔁 Shard ${id} reconnecting`));
client.on(Events.ShardReady, id => console.log(`🧩 Shard ${id} ready`));

/* ------------------------------------------------------------------ */
/* Core logic                                                           */
/* ------------------------------------------------------------------ */
async function checkAndNotify() {
  console.log('⏰ Running checkAndNotify');

  const now = Date.now();

  for (const [guildId, channels] of Object.entries(userAudioData)) {
    for (const [channelId, users] of Object.entries(channels)) {
      for (const [userId, data] of Object.entries(users)) {
        const lastAudio = data.lastAudio || 0;
        const daysLeft = TARGET_DAYS - (now - lastAudio) / 86400000;

        const threshold = [...NOTIFY_THRESHOLDS].reverse().find(t => daysLeft <= t);
        if (threshold === undefined || data.lastNotifiedThreshold === threshold) continue;

        console.log(`📣 Trigger ${threshold}-day for user ${userId}`);

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

          try {
            await member.send(msgText);
          } catch (err) {
            console.warn(`⚠️ Could not DM ${member.user.tag}:`, err.message);
          }

          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel?.isTextBased?.() || channel?.isTextBased) {
            await channel.send(msgText).catch(err => {
              console.warn(`⚠️ Failed to send to channel ${channelId}:`, err.message);
            });
          }

          data.lastNotifiedThreshold = threshold;
          saveData();

          console.log(`📩 Notified ${member.user.tag}`);
        } catch (err) {
          console.error('❌ Notify error:', err);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */
client.on('messageCreate', async message => {
  if (!message.guild || !message.content.startsWith('!')) return;

  console.log(`💬 Command received: ${message.content}`);

  const [cmd] = message.content.slice(1).split(/\s+/);

  if (cmd === 'check') {
    await message.channel.send('🔄 Updating recent audio posts...');
    await checkAndNotify();
    await message.channel.send('✅ Check complete.');
  }

  if (cmd === 'testping') {
    await message.channel.send('🧪 Running test notification simulation...');
    await checkAndNotify();
    await message.channel.send('✅ Test complete.');
  }
});

/* ------------------------------------------------------------------ */
/* Ready + scheduler                                                   */
/* ------------------------------------------------------------------ */
client.once('ready', () => {
  console.log(`✅ READY — Logged in as ${client.user.tag}`);
  console.log(`🏠 Connected to ${client.guilds.cache.size} guild(s)`);

  setTimeout(() => {
    console.log('⏱️ Initial checkAndNotify kick');
    checkAndNotify().catch(err => console.error('❌ Initial check failed:', err));

    setInterval(async () => {
      try {
        await checkAndNotify();
      } catch (err) {
        console.error('❌ Interval check failed:', err);
      }
    }, CHECK_INTERVAL_MINUTES * 60 * 1000);
  }, 10_000);
});

/* ------------------------------------------------------------------ */
/* LOGIN                                                               */
/* ------------------------------------------------------------------ */
console.log('🔐 About to call client.login()');

client.login(process.env.BOT_TOKEN)
  .then(() => console.log('🔑 client.login() resolved'))
  .catch(err => {
    console.error('❌ Discord login FAILED:', err);
    process.exit(1);
  });

setTimeout(() => console.log('⏳ 15s after login call — process still alive'), 15_000);
