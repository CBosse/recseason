import { createServer } from 'node:http';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';

const local = process.argv.slice(2).join(' ') === '--local';
if (!local && process.argv.length !== 2) throw new Error('Use no arguments for production or --local for emulators.');
const port = Number(process.env.PORT ?? 8082);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
const runtime = openReminderRuntime(local ? 'demo-recseason' : 'bosse-testing');
const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, runtime.handler);
server.listen(port, local ? '127.0.0.1' : '0.0.0.0', () => console.log(`Reminder endpoint listening on port ${port}; no sender is started.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await runtime.close(); }));
