// minimal_render_test_bot.js
import { Client, GatewayIntentBits, Events } from 'discord.js';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

console.log('🚀 Starting Render test bot');
console.log('🔍 ENV CHECK:', {
  BOT_TOKEN: process.env.BOT_TOKEN ? 'present' : '❌ MISSING',
  PORT: process.env.PORT,
  NODE_VERSION: process.version,
});

// HTTP server to satisfy Render Web Service requirement
const PORT = Number(process.env.PORT) || 10000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(req.url === '/health' ? 'ok' : 'Discord bot running');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

// Create Discord client with minimal intents
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Log low-level events to debug connection
client.on(Events.Debug, msg => console.log('🟣 DEBUG:', msg));
client.on(Events.Warn, msg => console.warn('🟡 WARN:', msg));
client.on(Events.Error, err => console.error('🔴 CLIENT ERROR:', err));

client.on(Events.ShardDisconnect, (event, id) => console.error(`🔌 Shard ${id} disconnected`, event));
client.on(Events.ShardReconnecting, id => console.log(`🔁 Shard ${id} reconnecting`));
client.on(Events.ShardReady, id => console.log(`🧩 Shard ${id} ready`));

// Ready event
client.once(Events.ClientReady, () => {
  console.log(`✅ READY — Logged in as ${client.user.tag}`);
});

// Login to Discord
client.login(process.env.BOT_TOKEN)
  .then(() => console.log('🔑 client.login() promise resolved'))
  .catch(err => {
    console.error('❌ Discord login FAILED:', err);
    process.exit(1);
  });

// Optional: keep process alive
setTimeout(() => console.log('⏳ 15s after login call — process still alive'), 15_000);
