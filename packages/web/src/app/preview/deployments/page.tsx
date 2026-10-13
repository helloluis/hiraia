import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeploymentMap } from '@/components/deployment-map/DeploymentMap';
import { Wordmark } from '@/components/brand/Wordmark';

export const metadata: Metadata = {title:'A Hiraia Archipelago · Preview',robots:{index:false,follow:false}};
export const dynamic = 'force-dynamic';

export default function DeploymentMapPreview() {
  // Keep the isolated design-review route development-only.
  if (process.env.NODE_ENV !== 'development') notFound();
  return <main className="mc" style={{background:'#F4EAD5',minHeight:'100vh',color:'#4D4740'}}>
    <div style={{maxWidth:1320,margin:'0 auto',padding:'24px 32px 0',display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>
      <span style={{fontSize:36}}><Wordmark /></span>
      <span style={{fontFamily:'monospace',fontSize:10,letterSpacing:2}}>PREVIEW</span>
    </div>
    <DeploymentMap />
  </main>;
}
