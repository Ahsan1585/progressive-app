import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { MasterReports } from '@/components/MasterReports';
import { BillingManager } from '@/components/BillingManager';
import { RegisterPractitionerForm } from '@/components/RegisterPractitionerForm';
import { CompanySettings } from '@/components/CompanySettings';
import { SubscriptionBilling } from '@/components/SubscriptionBilling';
import { AuditLogViewer } from '@/components/AuditLogViewer';
import RoleManagement from '@/pages/RoleManagement';
import { IdleTimeoutWarning } from '@/components/IdleTimeoutWarning';
import { TrialStatusBanner } from '@/components/TrialStatusBanner';
import { BaaGate } from '@/components/BaaGate';
import { TrialGate } from '@/components/TrialGate';
import { BrandLockup } from '@/components/BrandLockup';

// A tab's value is either a single permission key, or an array of keys with
// any-of semantics (the tab shows if the user holds at least one of them —
// used where one tab hosts several independently-grantable actions). Admin
// always sees everything.
const TAB_PERMISSION = {
  practitioners: 'staff_directory_view',
  reports:       'master_reports',
  billing:       ['billing_pending', 'billing_completed', 'billing_invoice_status'],
  company:       ['company_info_compliance_doc', 'company_info_dropdown_options'],
  subscription:  'subscription_billing',
  auditLog:      'audit_logs',
  roles:         'staff_directory_edit_role',
};

const TAB_TITLES = {
  practitioners: 'Staff Directory',
  reports:       'Master Reports',
  billing:       'Billing & Invoices',
  company:       'Company Information',
  subscription:  'Subscription & Billing',
  auditLog:      'Audit Log',
  roles:         'Roles & Permissions',
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    api.get('/api/auth/me')
      .then(res => setMe(res.data))
      .catch(() => setMe({ isAdmin: false, permissions: [], roleName: 'Staff' }));
  }, []);

  const hasTabAccess = (tab) => {
    if (!me) return false;
    if (me.isAdmin) return true;
    const key = TAB_PERMISSION[tab];
    if (Array.isArray(key)) return key.some(k => me.permissions.includes(k));
    return me.permissions.includes(key);
  };

  const visibleTabs = me ? Object.keys(TAB_PERMISSION).filter(hasTabAccess) : [];

  // activeTab stays null until permissions are fetched; once `me` resolves,
  // derive the initial tab from visibleTabs during render (no effect needed)
  // while still letting user clicks below override it via setActiveTab.
  const [explicitTab, setActiveTab] = useState(null);
  const activeTab = explicitTab ?? (me ? (visibleTabs[0] || 'billing') : null);

  const [adminProfile, setAdminProfile] = useState(null);
  const [companySettings, setCompanySettings] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile hamburger toggle
  const [desktopNavOpen, setDesktopNavOpen] = useState(false); // desktop hover-triggered flyout nav

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/login');
  };

  const toggleSidebar = () => {
    setSidebarOpen(o => !o);
    setDesktopNavOpen(o => !o);
  };

  useEffect(() => {
    api.get('/api/practitioner/profile')
      .then(res => { if (res.data) setAdminProfile(res.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Every admin-portal role reads this (sidebar branding), not just 'ceo'.
    api.get('/api/company')
      .then(res => { if (res.data.settings) setCompanySettings(res.data.settings); })
      .catch(() => {});
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'billing':
        return (
          <div className="max-w-6xl mx-auto w-full">
            <BillingManager />
          </div>
        );
      case 'practitioners':
        return (
          <div className="max-w-5xl mx-auto w-full">
            <RegisterPractitionerForm />
          </div>
        );
      case 'reports':
        return (
          <div className="max-w-7xl mx-auto w-full">
            <MasterReports />
          </div>
        );
      case 'company':
        return (
          <div className="max-w-5xl mx-auto w-full">
            <CompanySettings onSettingsChange={setCompanySettings} />
          </div>
        );
      case 'subscription':
        return (
          <div className="max-w-6xl mx-auto w-full">
            <SubscriptionBilling />
          </div>
        );
      case 'auditLog':
        return (
          <div className="max-w-6xl mx-auto w-full">
            <AuditLogViewer />
          </div>
        );
      case 'roles':
        return (
          <div className="max-w-5xl mx-auto w-full">
            <RoleManagement />
          </div>
        );
      default:
        return <BillingManager />;
    }
  };

  return (
    <TrialGate>
    <BaaGate>
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900 print:h-auto print:overflow-visible print:block">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="print:hidden fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => { setSidebarOpen(false); setDesktopNavOpen(false); }} />
      )}

      {/* Desktop hover strip — move the cursor to the left edge to reveal the nav; also tappable/focusable */}
      <button
        type="button"
        onMouseEnter={() => setDesktopNavOpen(true)}
        onClick={() => setDesktopNavOpen(true)}
        className="group print:hidden hidden md:flex fixed inset-y-0 left-0 w-5 z-40 items-center justify-center bg-transparent hover:bg-blue-50/50 transition-colors cursor-pointer"
        aria-label="Show navigation"
        title="Show navigation"
      >
        <span className="flex items-center justify-center w-6 h-20 rounded-r-md bg-slate-100 border border-l-0 border-slate-200 shadow-sm group-hover:bg-blue-50 group-hover:border-blue-200 transition-colors">
          <svg className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>

      {/* SIDEBAR — fixed overlay on all breakpoints; desktop reveals via hover, mobile via hamburger */}
      <aside
        className={`print:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col h-full shadow-lg transition-transform duration-200 ${
          sidebarOpen || desktopNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={() => { setDesktopNavOpen(false); setSidebarOpen(false); }}
      >
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            {companySettings?.logo && (
              <img
                src={companySettings.logo}
                alt=""
                className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-slate-200"
              />
            )}
            <h1 className="min-w-0 text-lg font-bold text-slate-800 tracking-tight leading-tight">
              {/* Agency names vary a lot in length — this header has plenty of
                  vertical room, so let the name wrap freely across as many
                  lines as it needs rather than ellipsis-truncating it (a
                  cut-off name reads as broken, not just long). */}
              <div>{companySettings?.display_name || 'Progressive Steps'}</div>
              <div className="truncate text-sm font-medium text-slate-500">Admin Portal</div>
            </h1>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">

          {visibleTabs.includes('practitioners') && (
            <button
              onClick={() => { setActiveTab('practitioners'); setSidebarOpen(false); setDesktopNavOpen(false); }}
              className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                activeTab === 'practitioners'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Staff Directory
            </button>
          )}

          {visibleTabs.includes('reports') && (
            <button
              onClick={() => { setActiveTab('reports'); setSidebarOpen(false); setDesktopNavOpen(false); }}
              className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                activeTab === 'reports'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Master Reports
            </button>
          )}

          {visibleTabs.includes('billing') && (
            <button
              onClick={() => { setActiveTab('billing'); setSidebarOpen(false); setDesktopNavOpen(false); }}
              className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                activeTab === 'billing'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
              </svg>
              Billing & Invoices
            </button>
          )}

        </nav>

        {/* "Useful Links" group — shows if ANY of its entries is visible; the
            group used to be gated on the Company tab alone, which would now
            hide Audit Log / Roles from someone who has those but not Company. */}
        {['company', 'subscription', 'auditLog', 'roles'].some(t => visibleTabs.includes(t)) && (
          <div className="p-4 border-t border-slate-100">
            <p className="px-4 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Useful Links</p>
            {visibleTabs.includes('company') && (
              <button
                onClick={() => { setActiveTab('company'); setSidebarOpen(false); setDesktopNavOpen(false); }}
                className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                  activeTab === 'company'
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l7-3 7 3z" />
                </svg>
                Company Information
              </button>
            )}
            {visibleTabs.includes('subscription') && (
              <button
                onClick={() => { setActiveTab('subscription'); setSidebarOpen(false); setDesktopNavOpen(false); }}
                className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                  activeTab === 'subscription'
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h2m4 0h4M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
                </svg>
                Subscription &amp; Billing
              </button>
            )}
            {visibleTabs.includes('auditLog') && (
              <button
                onClick={() => { setActiveTab('auditLog'); setSidebarOpen(false); setDesktopNavOpen(false); }}
                className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                  activeTab === 'auditLog'
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Audit Log
              </button>
            )}
            {visibleTabs.includes('roles') && (
              <button
                onClick={() => { setActiveTab('roles'); setSidebarOpen(false); setDesktopNavOpen(false); }}
                className={`w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                  activeTab === 'roles'
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2.5a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2.5a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21.5a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                Roles &amp; Permissions
              </button>
            )}
          </div>
        )}

        <div className="p-4 border-t border-slate-100 flex flex-col items-center">
          <BrandLockup size="sm" align="center" />
          <p className="text-xs text-slate-700 text-center font-medium mt-1.5">Securely Powered by Izaya</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden print:h-auto print:overflow-visible print:block">
        <header className="print:hidden relative h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shadow-sm shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              onClick={toggleSidebar}
              aria-label="Toggle menu"
              title="Toggle menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* The sidebar (tenant logo/name at its top, "Powered by Izaya" at its
                bottom) is hover/toggle-reveal, not persistently visible — so this
                bar is the one piece of chrome always on screen. It shows the
                tenant's own identity, not Izaya's; the Izaya mark already has its
                appropriately secondary home in the sidebar footer below. */}
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              {companySettings?.logo && (
                <img
                  src={companySettings.logo}
                  alt=""
                  className="h-7 w-7 flex-shrink-0 rounded-md border border-slate-200 object-cover"
                />
              )}
              <span className="truncate text-sm font-semibold text-slate-800">
                {companySettings?.display_name || 'Progressive Steps'}
              </span>
            </div>
          </div>
          <h2 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-slate-800 capitalize tracking-tight whitespace-nowrap">
            {TAB_TITLES[activeTab] || 'Billing & Invoices'}
          </h2>
          <div className="flex items-center gap-3">
            {adminProfile && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">
                    {adminProfile.first_name?.[0]}{adminProfile.last_name?.[0]}
                  </span>
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  {adminProfile.first_name} {adminProfile.last_name}
                </span>
                <span className="text-xs font-medium text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">
                  {me?.isAdmin ? 'Admin' : (me?.roleName || 'Staff')}
                </span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 md:px-4 py-2 rounded-lg transition-all min-h-[44px] cursor-pointer"
              title="Sign Out"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden md:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 print:h-auto print:overflow-visible print:p-0">
          <TrialStatusBanner />
          {renderContent()}
        </div>
      </main>

      <IdleTimeoutWarning onLogout={handleLogout} />
    </div>
    </BaaGate>
    </TrialGate>
  );
};

export default AdminDashboard;
