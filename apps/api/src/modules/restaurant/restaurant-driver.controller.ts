import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { RestaurantDeliveryService } from './delivery.service';
import { RestaurantDriverService } from './driver.service';
import { CompleteDeliveryDto, FailDeliveryDto, SetDutyStatusDto, TrackLocationDto } from './dto/restaurant.dto';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

/**
 * The rider's own surface — everything the driver app is allowed to touch, and nothing else.
 *
 * Every route here resolves the signed-in user to their rider record and passes that id down as the
 * *acting* rider, so the service can refuse a job that belongs to someone else. This is what replaces
 * the old arrangement, where the driver app called the same branch-wide dispatch routes as the
 * console and its own code carried a comment explaining it could not scope the board because the JWT
 * had no rider identity in it. Now it does.
 *
 * Guarded by `restaurant:delivery:run`, which only the DRIVER role holds. Note what is absent: no
 * assign (a rider cannot hand themselves work), no roster (they cannot enumerate colleagues), and no
 * OTP route — the code is quoted to them at the door by the customer, and that is the only thing that
 * makes completion evidence of anything.
 */
@Controller('restaurant/driver')
@RequiresFeature('restaurant')
@Permissions('restaurant:delivery:run')
export class RestaurantDriverController {
  constructor(
    private readonly drivers: RestaurantDriverService,
    private readonly deliveries: RestaurantDeliveryService,
    private readonly tenantTx: TenantTransactionService,
  ) {}

  /** Who am I, as a rider? The app calls this on launch to know if the login is linked yet. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.me(user.userId);
  }

  @Post('duty')
  @HttpCode(HttpStatus.OK)
  async setDuty(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetDutyStatusDto) {
    const me = await this.resolve(user);
    return this.drivers.setDuty(me, dto, me);
  }

  /** My runs: live work, plus what I finished today so a rider can check their own tally. */
  @Get('runs')
  async runs(@CurrentUser() user: AuthenticatedUser) {
    return this.deliveries.runsForDriver(await this.resolve(user));
  }

  @Post('runs/:id/pickup')
  @HttpCode(HttpStatus.OK)
  async pickup(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.pickup(id, await this.resolve(user));
  }

  @Post('runs/:id/enroute')
  @HttpCode(HttpStatus.OK)
  async enroute(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.enroute(id, await this.resolve(user));
  }

  @Post('runs/:id/track')
  @HttpCode(HttpStatus.OK)
  async track(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TrackLocationDto) {
    return this.deliveries.track(id, dto, await this.resolve(user));
  }

  @Post('runs/:id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteDeliveryDto) {
    return this.deliveries.complete(id, dto, await this.resolve(user));
  }

  @Post('runs/:id/fail')
  @HttpCode(HttpStatus.OK)
  async fail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FailDeliveryDto) {
    return this.deliveries.fail(id, dto, await this.resolve(user));
  }

  /** The signed-in user's rider id, or a 403 explaining that the login is not linked yet. */
  private resolve(user: AuthenticatedUser): Promise<string> {
    return this.tenantTx.run(async (m) => (await this.drivers.requireDriverForUser(m, user.userId)).id);
  }
}
