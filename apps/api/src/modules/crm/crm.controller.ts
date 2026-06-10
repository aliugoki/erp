import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateClientDto, CreateContactDto, CreateDealDto, UpdateDealStageDto } from './dto/crm.dto';
import { CrmService } from './crm.service';

const WRITE = [Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** CRM module — gated by the `crm` feature; writes require a sales rep (or admin). */
@Controller('crm')
@RequiresFeature('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // Clients
  @Get('clients')
  listClients() {
    return this.crm.listClients();
  }

  @Post('clients')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createClient(@Body() dto: CreateClientDto) {
    return this.crm.createClient(dto);
  }

  @Get('clients/:id/contacts')
  listContacts(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.listContacts(id);
  }

  // Contacts
  @Post('contacts')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createContact(@Body() dto: CreateContactDto) {
    return this.crm.createContact(dto);
  }

  // Deals — pipeline declared before :id so it isn't shadowed
  @Get('deals/pipeline')
  pipeline() {
    return this.crm.pipeline();
  }

  @Get('deals')
  listDeals() {
    return this.crm.listDeals();
  }

  @Post('deals')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createDeal(@Body() dto: CreateDealDto) {
    return this.crm.createDeal(dto);
  }

  @Get('deals/:id')
  getDeal(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getDeal(id);
  }

  @Patch('deals/:id/stage')
  @Roles(...WRITE)
  updateStage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealStageDto) {
    return this.crm.updateStage(id, dto.stage);
  }
}
