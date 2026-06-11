import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AppConfig } from '@metaxperts/config';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roles?: string[];
}

/**
 * Authenticated, tenant-scoped realtime gateway (Chunk 5.3). The Socket.IO handshake must carry a
 * valid access JWT (`auth.token`, `?token=`, or a Bearer header) — verified exactly as JwtAuthGuard
 * does (JWT_ACCESS_SECRET). On success the socket joins the room `tenant:<tenantId>`; every emit is
 * addressed to a tenant room, so a client of tenant A can never receive tenant B's events. Unauthed or
 * tenant-less sockets are disconnected immediately.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) return this.reject(client, 'missing token');
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      if (!payload.tenantId) return this.reject(client, 'token not bound to a tenant');
      client.data.tenantId = payload.tenantId;
      client.data.userId = payload.sub;
      void client.join(`tenant:${payload.tenantId}`);
      client.emit('ready', { tenantId: payload.tenantId });
    } catch {
      this.reject(client, 'invalid or expired token');
    }
  }

  /** Emit a domain event to every socket in a tenant's room. */
  emitToTenant(tenantId: string, type: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('event', { type, payload });
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as { token?: string } | undefined;
    const queryToken = client.handshake.query?.token;
    const header = client.handshake.headers?.authorization;
    return (
      auth?.token ??
      (typeof queryToken === 'string' ? queryToken : undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
    );
  }

  private reject(client: Socket, reason: string): void {
    this.logger.debug(`rejecting socket ${client.id}: ${reason}`);
    client.emit('unauthorized', { reason });
    client.disconnect(true);
  }
}
