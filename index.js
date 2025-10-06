// audio_tracker_bot - Multi-stage Ping + DM + Dry Run Manual Check (JavaScript, ESM)
// -----------------------------------------------------------------------------------

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// tiny HTTP server so Render web service sees an open port (keeps free web service happy)
import http from 'http';

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  // optional: basic index page
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot running');
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT} (for Render health checks)`);
});


// --- Discord client setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- Data persistence ---
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

// --- Config ---
const TARGET_DAYS = parseInt(process.env.TARGET_DAYS || '30', 10);
const NOTIFY_THRESHOLDS = [7, 3, 1, 0];
const CHECK_INTERVAL_MINUTES = parseInt(process.env.CHECK_INTERVAL_MINUTES || '60', 10);
const OWNER_ID = process.env.OWNER_ID;
const audioExtRe = /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i;

// Messages per threshold
const MESSAGES = {
  7: process.env.NOTIFY_7DAYS || "🤠 {user} you have 7 days left to post a track! 💣 {duedate}",
  3: process.env.NOTIFY_3DAYS || "{user}! ⚠️ 3 days left! Don't forget to post music! 🥺",
  1: process.env.NOTIFY_1DAY || "😱 {user}!!! 1 day left to post music! QUICK send something 🙏",
  0: process.env.NOTIFY_OVERDUE || "🚨🚨🚨 {user}!!!!! It's been over a month of no music! 😳😳😳"
};

// --- Helpers ---
function isAudioAttachment(att) {
  const name = att.name || '';
  const ct = att.contentType || '';
  return audioExtRe.test(name) || (ct && ct.startsWith('audio'));
}

// --- Audio detection ---
client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild) return;

  const trackChannels = process.env.TRACK_CHANNELS
    ? process.env.TRACK_CHANNELS.split(',').map((s) => s.trim())
    : null;

  if (trackChannels && !trackChannels.includes(message.channel.id)) return;
  if (!message.attachments.size) return;

  let foundAudio = false;
  for (const attachment of message.attachments.values()) {
    if (isAudioAttachment(attachment)) {
      foundAudio = true;
      break;
    }
  }
  if (!foundAudio) return;

  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const userId = message.author.id;
  const now = Date.now();

  userAudioData[guildId] ??= {};
  userAudioData[guildId][channelId] ??= {};
  userAudioData[guildId][channelId][userId] = {
    lastAudio: now,
    lastNotifiedThreshold: null
  };

  saveData();
  console.log(`🎵 Recorded audio for ${message.author.tag} in ${message.guild.name} / ${message.channel.name}`);
});

// --- Multi-stage notification system ---
async function checkAndNotify() {
  const now = Date.now();

  for (const [guildId, channels] of Object.entries(userAudioData || {})) {
    for (const [channelId, users] of Object.entries(channels || {})) {
      for (const [userId, data] of Object.entries(users || {})) {
        const lastAudio = data.lastAudio || 0;
        const daysSinceLastAudio = (now - lastAudio) / (1000 * 60 * 60 * 24);
        const daysLeft = TARGET_DAYS - daysSinceLastAudio;

        const thresholdToNotify = NOTIFY_THRESHOLDS.find(t => daysLeft <= t);
        if (thresholdToNotify === undefined) continue;
        if (data.lastNotifiedThreshold === thresholdToNotify) continue;

        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
          if (!member) continue;

          const dueDate = new Date(lastAudio + TARGET_DAYS * 24 * 60 * 60 * 1000);
          const dueDateStr = dueDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

          const messageText = MESSAGES[thresholdToNotify]
            .replace('{user}', member.toString())
            .replace('{duedate}', dueDateStr);

          // DM the user
          try { await member.send(messageText); } catch {}

          // Ping in channel
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel && channel.isTextBased() && typeof channel.send === 'function') {
            await channel.send(messageText);
          }

          userAudioData[guildId][channelId][userId].lastNotifiedThreshold = thresholdToNotify;
          saveData();
          console.log(`📩 Notified ${member.user.tag} for threshold ${thresholdToNotify}`);
        } catch (err) {
          console.error('Error notifying user:', err);
        }
      }
    }
  }
}

// --- Commands ---
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).split(/\s+/);
  const cmd = args[0].toLowerCase();

  // --- !check (anyone) ---
  if (cmd === 'check') {
    const now = Date.now();
    let output = '🚨 Days left for the gang 🚨\n';

    for (const [guildId, channels] of Object.entries(userAudioData || {})) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      for (const [channelId, users] of Object.entries(channels || {})) {
        for (const [userId, data] of Object.entries(users || {})) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;

          const lastAudio = data.lastAudio || 0;
          const daysSinceLastAudio = (now - lastAudio) / (1000 * 60 * 60 * 24);
          const daysLeft = Math.round(TARGET_DAYS - daysSinceLastAudio);

          const dueDate = new Date(lastAudio + TARGET_DAYS * 24 * 60 * 60 * 1000);
          const dueDateStr = dueDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

          const name = member.nickname || member.user.username;
          output += `${name}: ${daysLeft} days left (due ${dueDateStr})\n`;
        }
      }
    }

    const chunks = output.match(/[\s\S]{1,2000}/g);
    for (const chunk of chunks) message.channel.send('```' + chunk + '```');
  }

  // --- Owner-only commands ---
  else if (['seed', 'export', 'resetdata'].includes(cmd)) {
    if (message.author.id !== OWNER_ID) {
      return message.reply('⚠️ You are not authorized to use this command.');
    }

    // --- !export ---
    if (cmd === 'export') {
      try {
        await message.reply({ files: [{ attachment: DATA_FILE, name: 'audioData.json' }] });
      } catch (err) {
        message.reply('⚠️ Could not send file: ' + err.message);
      }
    }

    // --- !seed ---
    if (cmd === 'seed') {
      const limit = Math.min(parseInt(args[1] || '500', 10), 1000); // default 500, max 1000
      let fetchedMessages = [];
      let lastId = null;

      while (fetchedMessages.length < limit) {
        const options = { limit: Math.min(100, limit - fetchedMessages.length) };
        if (lastId) options.before = lastId;

        const batch = await message.channel.messages.fetch(options);
        if (!batch.size) break;

        fetchedMessages.push(...batch.values());
        lastId = batch.last().id;
      }

      for (const msg of fetchedMessages) {
        if (msg.author?.bot || !msg.attachments.size) continue;

        for (const att of msg.attachments.values()) {
          if (!isAudioAttachment(att)) continue;

          const gid = message.guild.id;
          const cid = message.channel.id;
          const uid = msg.author.id;
          userAudioData[gid] ??= {};
          userAudioData[gid][cid] ??= {};
          userAudioData[gid][cid][uid] = { lastAudio: msg.createdTimestamp, lastNotifiedThreshold: null };
        }
      }

      saveData();
      message.reply(`✅ Seeded data from the last ${fetchedMessages.length} messages.`);
    }

    // --- !resetdata ---
    if (cmd === 'resetdata') {
      userAudioData = {};
      saveData();
      message.reply('✅ All audio data has been reset.');
      console.log('🔄 Audio data reset by owner.');
    }
  }
});

// --- Ready + interval ---
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`Tracking monthly audio: ${TARGET_DAYS} days | Checking every ${CHECK_INTERVAL_MINUTES} minutes`);
  setTimeout(() => {
    checkAndNotify();
    setInterval(checkAndNotify, CHECK_INTERVAL_MINUTES * 60 * 1000);
  }, 10_000);
});

// --- Start bot ---
client.login(process.env.BOT_TOKEN);
