import { Landing } from '@/components/Landing';
import { DeploymentMap } from '@/components/deployment-map/DeploymentMap';

export default function Home() {
  return (
    <Landing
      afterDownload={
        <div id="archipelago" className="bg-[var(--stock)] py-6 sm:py-8">
          <DeploymentMap />
        </div>
      }
    />
  );
}
