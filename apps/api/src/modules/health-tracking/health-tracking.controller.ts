import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateBloodGlucoseReadingDto,
  CreateBloodPressureReadingDto,
  HealthSummaryQueryDto,
  ListHealthReadingsDto,
  UpdateBloodGlucoseReadingDto,
  UpdateBloodPressureReadingDto,
} from './dto/health-tracking.dto';
import { HealthTrackingService } from './health-tracking.service';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';

@ApiTags('patient health tracking')
@ApiCookieAuth('hv_access')
@Controller('patient/health-tracking')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class HealthTrackingController {
  constructor(private readonly tracking: HealthTrackingService) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiQuery({ name: 'startDate', required: false, type: String, example: '2026-11-01' })
  @ApiQuery({ name: 'endDate', required: false, type: String, example: '2026-11-30' })
  @ApiOperation({ summary: 'Summarize the authenticated patient’s health readings' })
  summary(@Query() query: HealthSummaryQueryDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.summary(request.auth!.userId, query);
  }

  @Post('blood-pressure')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({ summary: 'Record an authenticated patient’s blood pressure reading' })
  createBloodPressure(@Body() dto: CreateBloodPressureReadingDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.createBloodPressure(request.auth!.userId, dto, request);
  }

  @Get('blood-pressure')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'List the authenticated patient’s blood pressure readings' })
  listBloodPressure(@Query() query: ListHealthReadingsDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.listBloodPressure(request.auth!.userId, query);
  }

  @Get('blood-pressure/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Retrieve one owned blood pressure reading' })
  getBloodPressure(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.tracking.getBloodPressure(request.auth!.userId, id);
  }

  @Patch('blood-pressure/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit one owned blood pressure reading' })
  updateBloodPressure(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateBloodPressureReadingDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.updateBloodPressure(request.auth!.userId, id, dto, request);
  }

  @Delete('blood-pressure/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Soft-delete one owned blood pressure reading' })
  deleteBloodPressure(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.tracking.deleteBloodPressure(request.auth!.userId, id, request);
  }

  @Post('blood-glucose')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({ summary: 'Record an authenticated patient’s blood glucose reading' })
  createBloodGlucose(@Body() dto: CreateBloodGlucoseReadingDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.createBloodGlucose(request.auth!.userId, dto, request);
  }

  @Get('blood-glucose')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'List the authenticated patient’s glucose readings' })
  listBloodGlucose(@Query() query: ListHealthReadingsDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.listBloodGlucose(request.auth!.userId, query);
  }

  @Get('blood-glucose/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Retrieve one owned blood glucose reading' })
  getBloodGlucose(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.tracking.getBloodGlucose(request.auth!.userId, id);
  }

  @Patch('blood-glucose/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit one owned blood glucose reading' })
  updateBloodGlucose(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateBloodGlucoseReadingDto, @Req() request: AuthenticatedRequest) {
    return this.tracking.updateBloodGlucose(request.auth!.userId, id, dto, request);
  }

  @Delete('blood-glucose/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Soft-delete one owned blood glucose reading' })
  deleteBloodGlucose(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.tracking.deleteBloodGlucose(request.auth!.userId, id, request);
  }
}
