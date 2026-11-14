import {createHash} from 'node:crypto';

/** Bounded, process-local budgets. Never trust forwarded IP headers as identity. */
export function loginLimiter(){
 type Budget={count:number;expires:number};
 const accounts=new Map<string,Budget>(),sources=new Map<string,Budget>();
 const accountWindow=15*60_000,sourceWindow=60_000,capacity=1000;
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 return {
  consume(email:string,source:string):number{
   const now=Date.now();
   for(const map of [accounts,sources])for(const [key,value]of map)if(value.expires<=now)map.delete(key);
   const accountKey=digest(email.trim().toLowerCase()),sourceKey=digest(source);
   const account=accounts.get(accountKey),address=sources.get(sourceKey);
   // Fail closed at capacity: evicting active keys would allow a client to reset its budget.
   const wait=Math.max(account&&account.count>=10?account.expires-now:0,address&&address.count>=100?address.expires-now:0,!account&&accounts.size>=capacity?accountWindow:0,!address&&sources.size>=capacity?sourceWindow:0);
   if(wait>0)return Math.ceil(wait/1000);
   accounts.set(accountKey,{count:(account?.count??0)+1,expires:account?.expires??now+accountWindow});
   sources.set(sourceKey,{count:(address?.count??0)+1,expires:address?.expires??now+sourceWindow});
   return 0;
  },
 };
}
