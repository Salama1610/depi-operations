interface D1Result<T=Record<string,unknown>> { results:T[];success:boolean;meta:{changes:number} }
interface D1PreparedStatement {bind(...values:unknown[]):D1PreparedStatement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<D1Result<T>>;run():Promise<D1Result>}
interface D1Database {prepare(query:string):D1PreparedStatement;batch(statements:D1PreparedStatement[]):Promise<D1Result[]>}
interface Fetcher {fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>}
interface R2Bucket {put(key:string,value:ArrayBuffer|ArrayBufferView,options?:{httpMetadata?:{contentType:string}}):Promise<unknown>;get(key:string):Promise<{body:ReadableStream}|null>;delete(key:string):Promise<void>}
declare module 'cloudflare:workers' {export const env:{DB:D1Database;BUCKET:R2Bucket;AUTOMATION_HMAC_SECRET?:string;AUTOMATION_ACTOR_EMAIL?:string;VAULT_URL?:string;VAULT_TOKEN?:string;BACKUP_ENCRYPTION_KEY?:string;SUPABASE_URL?:string;SUPABASE_PUBLISHABLE_KEY?:string;SUPABASE_SERVICE_ROLE_KEY?:string;SUPABASE_EVIDENCE_BUCKET?:string;SUPABASE_DB_URL?:string;SUPABASE_DB_TRANSPORT?:string;CREDENTIAL_ENCRYPTION_KEY?:string;LOCAL_DATA_FALLBACK?:string}}
