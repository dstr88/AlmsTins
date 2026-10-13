import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(SALT_LENGTH);
	const hash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
	return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, saltB64, hashB64] = stored.split('$');
	if (scheme !== 'scrypt' || !saltB64 || !hashB64) {
		return false;
	}
	const salt = Buffer.from(saltB64, 'base64');
	const expected = Buffer.from(hashB64, 'base64');
	const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
	return crypto.timingSafeEqual(actual, expected);
}
