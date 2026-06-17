import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { FeedQueryDto, SetPreferenceDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * In-app notifications for the current user. Auth + tenant scoped (the global guards apply); not
 * feature-gated — every authenticated user has a notification feed. The recipient is always the JWT
 * principal, so a user can only ever read or manage their own notifications.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The current user's feed (default: unread). `?filter=all|archived&category=&page=&pageSize=`. */
  @Get()
  list(@Query() q: FeedQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.feed(user.userId, q);
  }

  /** Unread count for the bell badge. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.userId);
  }

  /** Per-category channel preferences. */
  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(user.userId);
  }

  @Put('preferences/:category')
  @HttpCode(HttpStatus.OK)
  setPreference(@Param('category') category: string, @Body() dto: SetPreferenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.setPreference(user.userId, category, dto);
  }

  /** Mark every unread notification read. */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markRead(id, user.userId);
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  markUnread(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markUnread(id, user.userId);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.archive(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.remove(id, user.userId);
  }
}
