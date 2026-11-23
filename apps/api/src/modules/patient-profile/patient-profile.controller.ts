import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import {
  UpdatePatientHealthInformationDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto';
import { PatientProfileService } from './patient-profile.service';
import { PatientProfileRateLimitGuard } from './patient-profile-rate-limit.guard';

@ApiTags('patient profile')
@ApiCookieAuth('hv_access')
@Controller('patient')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class PatientProfileController {
  constructor(private readonly profiles: PatientProfileService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Return the authenticated patient profile' })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.profiles.getProfile(request.auth!.userId, request);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Create or update the authenticated patient profile' })
  updateProfile(@Body() dto: UpdatePatientProfileDto, @Req() request: AuthenticatedRequest) {
    return this.profiles.updateProfile(request.auth!.userId, dto, request);
  }

  @Get('health-information')
  @ApiOperation({ summary: 'Return the authenticated patient health information' })
  getHealthInformation(@Req() request: AuthenticatedRequest) {
    return this.profiles.getHealthInformation(request.auth!.userId, request);
  }

  @Put('health-information')
  @ApiOperation({ summary: 'Create or update patient-provided health information' })
  updateHealthInformation(
    @Body() dto: UpdatePatientHealthInformationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.updateHealthInformation(request.auth!.userId, dto, request);
  }

  @Get('profile/completion')
  @ApiOperation({ summary: 'Return profile completion and recommended missing fields' })
  getCompletion(@Req() request: AuthenticatedRequest) {
    return this.profiles.getCompletion(request.auth!.userId, request);
  }
}
