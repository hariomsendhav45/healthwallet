import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { OpenAiProvider } from './openai.provider';
import { AI_PROVIDER } from './ai-provider';
import { MedicalKnowledgeController } from './medical-knowledge.controller';
import { MedicalKnowledgeService } from './medical-knowledge.service';
import { PatientIntelligenceController, PatientRemindersController, AiFeedbackController } from './patient-intelligence.controller';
import { PatientIntelligenceService } from './patient-intelligence.service';
import { PredictiveAnalyticsService } from './predictive-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AiAssistantController, MedicalKnowledgeController, PatientIntelligenceController, PatientRemindersController, AiFeedbackController],
  providers: [PatientProfileRateLimitGuard, TokenService, SecurityRateLimiter, AiAssistantService, MedicalKnowledgeService, PatientIntelligenceService, PredictiveAnalyticsService, OpenAiProvider, { provide: AI_PROVIDER, useExisting: OpenAiProvider }],
})
export class AiAssistantModule {}
