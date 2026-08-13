import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RestaurantCustomerAuthService, type CustomerPrincipal } from './customer-auth.service';
import { CurrentCustomer, CustomerAuthGuard } from './customer-auth.guard';
import { RestaurantCustomerService } from './customer.service';
import { RestaurantMenuService } from './menu.service';
import {
  CreateCustomerAddressDto,
  PlaceCustomerOrderDto,
  RequestOtpDto,
  UpdateCustomerAddressDto,
  UpdateCustomerDto,
  VerifyOtpDto,
} from './dto/restaurant.dto';

/**
 * The customer app's surface: sign in by phone, keep an address book, see your own orders.
 *
 * `@Public()` here means only that the *staff* JWT guard does not apply — these routes are not open.
 * `CustomerAuthGuard` replaces it and demands a customer token, so a staff token is refused on this
 * surface exactly as a customer token is refused everywhere else in the ERP. That mutual rejection is
 * what makes it safe to publish this app to the public at all; before it, the customer app signed in
 * with restaurant staff credentials and any customer holding them could drive the whole console API.
 *
 * Note the shape of every route: the customer is taken from the token, never from the path or body.
 * There is deliberately no `GET /customers/:id` here — the only customer a caller on this surface can
 * name is themselves.
 *
 * The auth routes are rate-limited inside the service (codes per number per hour, attempts per code),
 * because an OTP endpoint that anyone may call is also an endpoint anyone may use to run up an SMS
 * bill or grind a six-digit secret.
 */
@Controller('restaurant/customer')
@Public()
export class RestaurantCustomerController {
  constructor(
    private readonly auth: RestaurantCustomerAuthService,
    private readonly customers: RestaurantCustomerService,
    private readonly menu: RestaurantMenuService,
  ) {}

  // ── Sign in ───────────────────────────────────────────────────────────────────
  @Post('auth/request-otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto, @Ip() ip: string) {
    return this.auth.requestOtp(dto, ip);
  }

  /** Verifying is also signing up: a phone the restaurant has never seen becomes a customer here. */
  @Post('auth/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  // ── Browse & order ────────────────────────────────────────────────────────────
  /**
   * The outlets a customer may order from.
   *
   * Mirrored onto this surface rather than reusing the staff route, because a customer token cannot
   * reach `/restaurant/branches` — and it should not: a customer needs a name and an id to order
   * against, not the operational detail staff see.
   */
  @Get('branches')
  @UseGuards(CustomerAuthGuard)
  async branches() {
    const all = (await this.menu.listBranches()) as Array<{ id: string; name: string; code: string | null; configured?: boolean; active?: boolean }>;
    return all
      .filter((b) => b.active !== false && b.configured !== false)
      .map((b) => ({ id: b.id, name: b.name, code: b.code ?? null }));
  }

  /** Categories and available dishes in one call — a menu screen should not need three. */
  @Get('menu')
  @UseGuards(CustomerAuthGuard)
  async menuFor(@Query('branchId') branchId?: string) {
    const [categories, items] = await Promise.all([
      this.menu.listCategories(),
      this.menu.listItems({ branchId, available: 'true' }),
    ]);
    return { categories, items };
  }

  /**
   * Place an order. One call: basket in, placed order out.
   *
   * The customer is taken from the token, so an order can only ever be placed as yourself — and it is
   * the first path in this system that populates `restaurant_order.customer_id`, which is what makes
   * order history, saved addresses and "call the customer" work at all.
   */
  @Post('orders')
  @UseGuards(CustomerAuthGuard)
  placeOrder(@CurrentCustomer() customer: CustomerPrincipal, @Body() dto: PlaceCustomerOrderDto) {
    return this.customers.placeOrder(customer.customerId, dto);
  }

  /** Track one of my orders — including which rider has it and their number. */
  @Get('orders/:id')
  @UseGuards(CustomerAuthGuard)
  order(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.order(customer.customerId, id);
  }

  // ── Me ────────────────────────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(CustomerAuthGuard)
  me(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.customers.profile(customer.customerId);
  }

  @Patch('me')
  @UseGuards(CustomerAuthGuard)
  updateMe(@CurrentCustomer() customer: CustomerPrincipal, @Body() dto: UpdateCustomerDto) {
    return this.customers.updateProfile(customer.customerId, dto);
  }

  @Get('orders')
  @UseGuards(CustomerAuthGuard)
  orders(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.customers.orders(customer.customerId);
  }

  // ── Address book ──────────────────────────────────────────────────────────────
  @Get('addresses')
  @UseGuards(CustomerAuthGuard)
  addresses(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.customers.addresses(customer.customerId);
  }

  @Post('addresses')
  @UseGuards(CustomerAuthGuard)
  addAddress(@CurrentCustomer() customer: CustomerPrincipal, @Body() dto: CreateCustomerAddressDto) {
    return this.customers.addAddress(customer.customerId, dto);
  }

  @Patch('addresses/:id')
  @UseGuards(CustomerAuthGuard)
  updateAddress(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.customers.updateAddress(customer.customerId, id, dto);
  }

  @Delete('addresses/:id')
  @UseGuards(CustomerAuthGuard)
  removeAddress(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.removeAddress(customer.customerId, id);
  }
}
