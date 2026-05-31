import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { AccountsScreen } from "./AccountsScreen";
import { KiroScreen } from "./KiroScreen";

type AccountManagementTab = "oauth" | "kiro";

type AccountManagementScreenProps = {
  accountId?: string;
  initialTab?: AccountManagementTab;
};

export function AccountManagementScreen({ accountId, initialTab = "oauth" }: AccountManagementScreenProps) {
  const [activeTab, setActiveTab] = useState<AccountManagementTab>(initialTab);

  // Determine if we're in a detail view
  const isDetailView = !!accountId;

  // For detail views, determine which tab based on the route
  const detailTab = window.location.hash.includes('/kiro/') ? 'kiro' : 'oauth';
  const currentTab = isDetailView ? detailTab : activeTab;

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Account Management"
        title="Provider Accounts"
        description="Manage OAuth and AWS CodeWhisperer accounts"
      />

      {/* Tab Navigation - only show if not in detail view */}
      {!isDetailView && (
        <div className="tab-navigation">
          <div className="tab-list">
            <button
              className={`tab-button ${currentTab === 'oauth' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveTab('oauth')}
            >
              OAuth Accounts
            </button>
            <button
              className={`tab-button ${currentTab === 'kiro' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveTab('kiro')}
            >
              Kiro Accounts
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div className="tab-content">
        {currentTab === 'oauth' && <AccountsScreen accountId={accountId} />}
        {currentTab === 'kiro' && <KiroScreen accountId={accountId} />}
      </div>
    </div>
  );
}