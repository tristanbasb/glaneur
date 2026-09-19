import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { getSettings } from './settings.js';

/** Public base URL used in feed links: PUBLIC_URL, then the setting, then the request itself. */
export function baseUrl(req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl;
  const configured = getSettings().publicUrl;
  if (configured) return configured;
  return `${req.protocol}://${req.host}`;
}
