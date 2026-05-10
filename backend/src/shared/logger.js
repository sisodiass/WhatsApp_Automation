import winston from "winston";
import { config } from "../config/index.js";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = printf(({ timestamp, level, message, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} ${level} ${stack || message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: config.logLevel,
  format:
    config.env === "production"
      ? combine(timestamp(), errors({ stack: true }), json())
      : combine(colorize(), timestamp({ format: "HH:mm:ss" }), errors({ stack: true }), devFormat),
  transports: [new winston.transports.Console()],
});

export function child(scope) {
  return logger.child({ scope });
}
