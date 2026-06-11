import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { NotificationsService } from './notifications.service';

/**
 * In-app notifications for the current user. Auth + tenant scoped (the global guards apply); not
 * feature-gated — every authenticated user has a notification feed. The recipient is always the JWT
 * principal, so a user can only ever read or mark their own notifications.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The current user's unread notifications. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listUnread(user.userId);
  }

  /** Mark one of my notifications read. */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markRead(id, user.userId);
  }
}
