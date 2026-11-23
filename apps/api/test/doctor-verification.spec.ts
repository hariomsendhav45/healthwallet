import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../src/database/prisma.service';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { DoctorReviewDto } from '../src/modules/doctor-verification/doctor-verification.dto';
import { DoctorVerificationService } from '../src/modules/doctor-verification/doctor-verification.service';

const doctor='22222222-2222-4222-8222-222222222222'; const admin='11111111-1111-4111-8111-111111111111';
const profile='33333333-3333-4333-8333-333333333333';
const config={get:(_key:string, fallback:string)=>fallback} as never;
const emptyFileStorage={put:jest.fn(),get:jest.fn(),delete:jest.fn(),head:jest.fn()};
const scanner={scan:jest.fn().mockResolvedValue('CLEAN')};
function service(prisma: object) { return new DoctorVerificationService(prisma as PrismaService, config, emptyFileStorage as never, scanner as never); }

describe('doctor verification workflow',()=>{
  it('requires complete details and at least one document before submission',async()=>{
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({role:'DOCTOR',phoneVerified:true,doctorVerificationStatus:'PENDING',doctorProfile:null})}};
    await expect(service(prisma).submit(doctor)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('moves a phone-verified complete application to UNDER_REVIEW',async()=>{
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({role:'DOCTOR',phoneVerified:true,doctorVerificationStatus:'PENDING',doctorProfile:{fullName:'A',professionalRegistrationNo:'R',registrationAuthority:'Council',qualification:'MBBS',specialization:'General',documents:[{id:'d'}]}}),update:jest.fn().mockResolvedValue({doctorVerificationStatus:'UNDER_REVIEW'})}};
    expect((await service(prisma).submit(doctor)).status).toBe('UNDER_REVIEW');
    expect(prisma.user.update).toHaveBeenCalledWith({where:{id:doctor},data:{doctorVerificationStatus:'UNDER_REVIEW'}});
  });
  it('requires the admin review reason and accepts only supported target states',async()=>{
    expect(await validate(plainToInstance(DoctorReviewDto,{status:'APPROVED',reason:''}))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DoctorReviewDto,{status:'VERIFIED',reason:'ok'}))).not.toHaveLength(0);
  });
  it('records reviewer, decision, timestamp and reason on approval',async()=>{
    const tx={user:{update:jest.fn()},doctorVerificationAudit:{create:jest.fn()}};
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({id:doctor,role:'DOCTOR',accountStatus:'ACTIVE',doctorVerificationStatus:'UNDER_REVIEW',phoneVerified:true,doctorProfile:{id:profile,fullName:'A',professionalRegistrationNo:'R',registrationAuthority:'Council',qualification:'MBBS',specialization:'General',documents:[{scanStatus:'CLEAN'}]}})},$transaction:jest.fn(async(fn:(v:typeof tx)=>unknown)=>fn(tx))};
    await service(prisma).review(admin,doctor,{status:'APPROVED',reason:'Documents reviewed manually'});
    expect(tx.user.update).toHaveBeenCalledWith({where:{id:doctor},data:{doctorVerificationStatus:'APPROVED'}});
    expect(tx.doctorVerificationAudit.create).toHaveBeenCalledWith({data:{doctorProfileId:profile,reviewerUserId:admin,fromStatus:'UNDER_REVIEW',toStatus:'APPROVED',reason:'Documents reviewed manually'}});
  });
  it('does not permit approval without mobile verification and uploaded details',async()=>{
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({id:doctor,role:'DOCTOR',accountStatus:'ACTIVE',doctorVerificationStatus:'UNDER_REVIEW',phoneVerified:false,doctorProfile:{id:profile,fullName:'A',professionalRegistrationNo:'R',registrationAuthority:'Council',qualification:'MBBS',specialization:'General',documents:[{scanStatus:'CLEAN'}]}})}};
    await expect(service(prisma).review(admin,doctor,{status:'APPROVED',reason:'Reviewed'})).rejects.toBeInstanceOf(BadRequestException);
  });
  it('blocks non-admin roles from admin routes',()=>{
    const reflector={getAllAndOverride:()=>['ADMIN']};
    const guard=new RolesGuard(reflector as never);
    const context={getHandler:()=>({}),getClass:()=>({}),switchToHttp:()=>({getRequest:()=>({auth:{role:'DOCTOR',doctorVerificationStatus:'APPROVED'} as AuthenticatedRequest['auth']})})} as never;
    expect(()=>guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
