import Operations from './operations';
import StudentServicesPage from './student/page';
import { identity, studentByIdentity } from '@/lib/server';
export const dynamic = "force-dynamic";
export default async function Page(){
  let isStudent = false;
  try {
    const i = await identity();
    isStudent = Boolean(await studentByIdentity(i));
  } catch {}
  if (isStudent) return <StudentServicesPage />;
  return <Operations module="home"/>;
}
