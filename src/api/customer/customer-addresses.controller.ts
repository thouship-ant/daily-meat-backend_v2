import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Message } from '../../common/api-response';
import { Auth, CurrentUser, ResponseMessage } from '../../common/decorators';
import { AddressesService } from '../../modules/addresses/addresses.service';
import { ApprovedAddressesService } from '../../modules/addresses/approved-addresses.service';
import { AddressDto, UpdateAddressDto } from './dto/customer.dto';

@ApiTags('Customer · Addresses')
@Auth('CUSTOMER')
@Controller('addresses')
export class CustomerAddressesController {
  constructor(
    private readonly addresses: AddressesService,
    private readonly approved: ApprovedAddressesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My saved addresses (default first)' })
  list(@CurrentUser('id') userId: string) {
    return this.addresses.list(userId);
  }

  @Get('approved')
  @ApiOperation({ summary: 'Addresses an admin marked as correct (normalised keys), so the app check can accept them too' })
  approvedKeys() {
    return this.approved.listKeys();
  }

  @Post()
  @ResponseMessage('Address saved.')
  @ApiOperation({ summary: 'Add an address; tells whether we deliver there' })
  create(@CurrentUser('id') userId: string, @Body() dto: AddressDto) {
    return this.addresses.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an address' })
  update(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAddressDto) {
    return this.addresses.update(userId, id, dto);
  }

  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({ summary: 'Make this my default address' })
  setDefault(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.addresses.setDefault(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an address' })
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.addresses.remove(userId, id);
    return new Message('Address deleted.');
  }
}
