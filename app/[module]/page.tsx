import Operations from '../operations';
export default async function Page({params}:{params:Promise<{module:string}>}){const {module}=await params;return <Operations module={module}/>}
