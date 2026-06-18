import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerAuthService } from '../ecommerce/customer-auth.service';
import { StorefrontService } from '../ecommerce/storefront.service';
import { CsatDto, PortalCreateTicketDto, PortalReplyDto } from './dto/helpdesk.dto';
import { HelpdeskService } from './helpdesk.service';

/**
 * Customer support portal — a signed-in storefront customer raises and tracks tickets from
 * `/shop/:slug/support`. Reuses the storefront's slug→tenant resolution and the customer session token
 * (no staff auth). Internal notes are never exposed here. Marked `@Public()`; the customer token is
 * verified per request.
 */
@Public()
@Controller('shop/:slug/support')
export class HelpdeskPortalController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly customers: CustomerAuthService,
    private readonly hd: HelpdeskService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Param('slug') slug: string, @Body() dto: PortalCreateTicketDto, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.hd.portalCreate(customer, dto);
  }

  @Get()
  async list(@Param('slug') slug: string, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.hd.portalList(customer);
  }

  @Get(':ticketNo')
  async get(@Param('slug') slug: string, @Param('ticketNo') ticketNo: string, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.hd.portalGet(customer, ticketNo);
  }

  @Post(':ticketNo/reply')
  @HttpCode(HttpStatus.OK)
  async reply(@Param('slug') slug: string, @Param('ticketNo') ticketNo: string, @Body() dto: PortalReplyDto, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.hd.portalReply(customer, ticketNo, dto.body);
  }

  @Post(':ticketNo/csat')
  @HttpCode(HttpStatus.OK)
  async csat(@Param('slug') slug: string, @Param('ticketNo') ticketNo: string, @Body() dto: CsatDto, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.hd.portalCsat(customer, ticketNo, dto.rating, dto.comment);
  }
}
