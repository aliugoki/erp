import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  CreateClientDto, CreateContactDto, CreateDealDto,
  UpdateClientDto, UpdateContactDto, UpdateDealDto, UpdateDealStageDto,
} from './dto/crm.dto';
import { CrmService } from './crm.service';


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
  @Permissions('crm:account:write')
  @HttpCode(HttpStatus.CREATED)
  createClient(@Body() dto: CreateClientDto) {
    return this.crm.createClient(dto);
  }

  @Get('clients/:id/contacts')
  listContacts(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.listContacts(id);
  }

  @Get('clients/:id')
  getClient(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getClient(id);
  }

  @Patch('clients/:id')
  @Permissions('crm:account:write')
  updateClient(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.crm.updateClient(id, dto);
  }

  @Delete('clients/:id')
  @Permissions('crm:account:write')
  @HttpCode(HttpStatus.OK)
  deleteClient(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteClient(id);
  }

  // Contacts
  @Post('contacts')
  @Permissions('crm:contact:write')
  @HttpCode(HttpStatus.CREATED)
  createContact(@Body() dto: CreateContactDto) {
    return this.crm.createContact(dto);
  }

  @Patch('contacts/:id')
  @Permissions('crm:contact:write')
  updateContact(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.crm.updateContact(id, dto);
  }

  @Delete('contacts/:id')
  @Permissions('crm:contact:write')
  @HttpCode(HttpStatus.OK)
  deleteContact(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteContact(id);
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
  @Permissions('crm:deal:write')
  @HttpCode(HttpStatus.CREATED)
  createDeal(@Body() dto: CreateDealDto) {
    return this.crm.createDeal(dto);
  }

  @Get('deals/:id')
  getDeal(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getDeal(id);
  }

  @Patch('deals/:id/stage')
  @Permissions('crm:deal:write')
  updateStage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealStageDto) {
    return this.crm.updateStage(id, dto.stage, dto.lostReason ?? null);
  }

  @Patch('deals/:id')
  @Permissions('crm:deal:write')
  updateDeal(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.crm.updateDeal(id, dto);
  }

  @Delete('deals/:id')
  @Permissions('crm:deal:write')
  @HttpCode(HttpStatus.OK)
  deleteDeal(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteDeal(id);
  }
}
