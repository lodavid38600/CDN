import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';

await connectDb();
console.log(`MongoDB connecté (${config.mongoUrl.replace(/\/\/.*@/, '//***@')})`);
createApp().listen(config.port, () => {
  console.log(`API douanière démarrée sur http://localhost:${config.port}`);
});
