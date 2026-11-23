'use client';
import { useParams } from 'next/navigation';
import { AdminDoctorsPage } from '../../../../components/doctor-portal-pages';
export default function Page() { const params = useParams<{id:string}>(); return <AdminDoctorsPage doctorId={params.id} />; }
