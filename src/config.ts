import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3100),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DATABASE_URL: z.string().url().default('postgresql://cotos:cotos@localhost:5432/cotos'),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // AI Providers
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Telegram Bot API
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_BOT_TOKEN: z.string().optional(),

  // Telegram Channel
  CHANNEL_ID: z.string().optional(),
  ADMIN_CHAT_ID: z.string().optional(),

  // Telegram User Account (for parsing)
  TG_BRIDGE_URL: z.string().url().default('http://127.0.0.1:8647'),

  // RSS
  RSS_REFRESH_INTERVAL_MINUTES: z.coerce.number().default(15),

  // Scheduler timezone
  TIMEZONE: z.string().default('Asia/Jakarta'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadConfig(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  _env = result.data;
  return _env;
}
