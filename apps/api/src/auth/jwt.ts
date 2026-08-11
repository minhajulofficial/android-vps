import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  username: string;
  role: 'admin' | 'user';
  iat: number;
  exp: number;
}

export interface TokenService {
  sign(user: { id: string; username: string; role: 'admin' | 'user' }): string;
  verify(token: string): JwtPayload;
}

export function createTokenService(secret: string, expiresIn: string): TokenService {
  const sign = (user: { id: string; username: string; role: 'admin' | 'user' }): string => {
    return jwt.sign({ username: user.username, role: user.role }, secret, {
      subject: user.id,
      expiresIn: expiresIn as jwt.SignOptions['expiresIn']
    });
  };

  const verify = (token: string): JwtPayload => {
    return jwt.verify(token, secret) as JwtPayload;
  };

  return { sign, verify };
}

export function bearerTokenFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}