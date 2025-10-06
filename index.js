// audio_tracker_bot - Multi-stage Ping + DM + Dry Run Manual Check (JavaScript, ESM)
// -----------------------------------------------------------------------------------

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import http from 'http';

// --- Tiny HTTP server for Render ---
const PORT = parseInt(process.env.PORT || '3000', 10);
http.createServer((req, res) => {
  if (req.url === '/health') res.end('ok');
  else res.end('Discord bot running');
}).listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

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
  try { userAudioData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); }
  catch (err) { console.error('⚠️ Failed to parse data file, starting fresh:', err); userAudioData = {}; }
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(userAudioData, null, 2)); }

// --- Config ---
const TARGET_DAYS = parseInt(process.env.TARGET_DAYS || '30', 10);
const NOTIFY_THRESHOLDS = [7, 3, 1, 0];
const CHECK_INTERVAL_MINUTES = parseInt(process.env.CHECK_INTERVAL_MINUTES || '60', 10);
const OWNER_ID = process.env.OWNER_ID;
const audioExtRe = /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i;

// --- Messages per threshold ---
const MESSAGES = {
  7: process.env.NOTIFY_7DAYS || "🤠 {user} you have 7 days left to post a track! 💣 {duedate}",
  3: process.env.NOTIFY_3DAYS || "{user}! ⚠️ 3 days left! Don't forget to post music! 🥺",
  1: process.env.NOTIFY_1DAY || "😱 {user}!!! 1 day left to post music! QUICK send something 🙏",
  0: process.env.NOTIFY_OVERDUE || "🚨🚨🚨 {user}!!!!! It's been over a month of no music! 😳😳😳"
};

// --- Helpers ---
function isAudioAttachment(att) {
  return att.name && audioExtRe.test(att.name.trim());
}

// --- Audio detection on new messages ---
client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild) return;

  const trackChannels = process.env.TRACK_CHANNELS?.split(',').map(s => s.trim()) || [];
  if (!trackChannels.includes(message.channel.id)) return;
  if (!message.attachments.size) return;

  if (![...message.attachments.values()].some(isAudioAttachment)) return;

  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const userId = message.author.id;

  userAudioData[guildId] ??= {};
  userAudioData[guildId][channelId] ??= {};
  userAudioData[guildId][channelId][userId] = { lastAudio: Date.now(), lastNotifiedThreshold: null };

  saveData();
  console.log(`🎵 Recorded audio for ${message.author.tag} in ${message.guild.name} / ${message.channel.name}`);
});

// --- Multi-stage notification system ---
async function checkAndNotify() {
  const now = Date.now();

  for (const [guildId, channels] of Object.entries(userAudioData)) {
    for (const [channelId, users] of Object.entries(channels)) {
      for (const [userId, data] of Object.entries(users)) {
        const lastAudio = data.lastAudio || 0;
        const daysSinceLastAudio = (now - lastAudio) / (1000 * 60 * 60 * 24);
        const daysLeft = TARGET_DAYS - daysSinceLastAudio;

        const threshold = NOTIFY_THRESHOLDS.find(t => daysLeft <= t);
        if (threshold === undefined || data.lastNotifiedThreshold === threshold) continue;

        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
          if (!member) continue;

          const dueDateStr = new Date(lastAudio + TARGET_DAYS*24*60*60*1000)
            .toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });

          const msgText = MESSAGES[threshold].replace('{user}', member.toString()).replace('{duedate}', dueDateStr);

          try { await member.send(msgText); } catch {}
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel?.isTextBased?.() && typeof channel.send === 'function') await channel.send(msgText);

          userAudioData[guildId][channelId][userId].lastNotifiedThreshold = threshold;
          saveData();
          console.log(`📩 Notified ${member.user.tag} for threshold ${threshold}`);
        } catch (err) { console.error('Error notifying user:', err); }
      }
    }
  }
}

// --- Commands ---
client.on('messageCreate', async (message) => {
  if (!message.guild || !message.content.startsWith('!')) return;
  const args = message.content.slice(1).split(/\s+/);
  const cmd = args[0].toLowerCase();

  if (cmd === 'check') {
    const now = Date.now();
    let output = '🚨 Days left for the gang 🚨\n';

    for (const [guildId, channels] of Object.entries(userAudioData)) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      for (const [channelId, users] of Object.entries(channels)) {
        for (const [userId, data] of Object.entries(users)) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;

          const daysLeft = Math.round(TARGET_DAYS - (now - (data.lastAudio||0))/(1000*60*60*24));
          const dueDateStr = new Date(data.lastAudio + TARGET_DAYS*24*60*60*1000)
            .toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });
          output += `${member.nickname||member.user.username}: ${daysLeft} days left (due ${dueDateStr})\n`;
        }
      }
    }

    for (const chunk of output.match(/[\s\S]{1,2000}/g) || []) {
      message.channel.send('```' + chunk + '```');
    }
  }

  else if (['seed','export','resetdata'].includes(cmd)) {
    if (message.author.id !== OWNER_ID) return message.reply('⚠️ You are not authorized.');

    // --- !export ---
    if (cmd==='export') {
      try { await message.reply({ files:[{ attachment: DATA_FILE, name:'audioData.json' }] }); }
      catch(err){ message.reply('⚠️ Could not send file: '+err.message); }
    }

    // --- !seed ---
    if (cmd==='seed') {
      const limit = Math.min(parseInt(args[1]||'500',10),1000);
      let fetched = [], lastId = null;
      while(fetched.length<limit){
        const opts={limit:Math.min(100,limit-fetched.length)};
        if(lastId) opts.before = lastId;
        const batch = await message.channel.messages.fetch(opts);
        if(!batch.size) break;
        fetched.push(...batch.values());
        lastId = batch.last().id;
      }

      for(const msg of fetched){
        if(msg.author?.bot||!msg.attachments.size) continue;
        for(const att of msg.attachments.values()){
          if(!isAudioAttachment(att)) continue;
          const gid = message.guild.id, cid = message.channel.id, uid = msg.author.id;
          userAudioData[gid] ??= {}; userAudioData[gid][cid] ??= {};
          userAudioData[gid][cid][uid] = { lastAudio: msg.createdTimestamp, lastNotifiedThreshold:null };
        }
      }
      saveData();
      message.reply(`✅ Seeded ${fetched.length} messages with audio.`);
    }

    // --- !resetdata ---
    if(cmd==='resetdata'){ userAudioData={}; saveData(); message.reply('✅ Audio data reset.'); console.log('🔄 Audio data reset by owner.'); }
  }
});

// --- Ready + interval ---
client.once('ready', ()=>{
  console.log(`✅ Logged in as ${client.user.tag}`);
  setTimeout(()=>{ checkAndNotify(); setInterval(checkAndNotify,CHECK_INTERVAL_MINUTES*60*1000); },10000);
});

// --- Start bot ---
client.login(process.env.BOT_TOKEN);
