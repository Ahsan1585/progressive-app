import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { MasterReports } from '@/components/MasterReports';
import { BillingManager } from '@/components/BillingManager';
import { RegisterPractitionerForm } from '@/components/RegisterPractitionerForm';
import izayaLogo from '@/assets/izaya-logo.png';

const TAB_ACCESS = {
  practitioners: ['ceo', 'staff_director', 'account_specialist'],
  reports:       ['ceo'],
  billing:       ['ceo', 'billing', 'account_specialist'],
};

const ROLE_LABELS = {
  ceo:                'Admin',
  staff_director:     'Office Manager',
  billing:            'Billing Specialist',
  account_specialist: 'Account Specialist',
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const userRole = localStorage.getItem('role');

  const visibleTabs = Object.keys(TAB_ACCESS).filter(tab => TAB_ACCESS[tab].includes(userRole));

  const [activeTab, setActiveTab] = useState(() => {
    return Object.keys(TAB_ACCESS).find(tab => TAB_ACCESS[tab].includes(userRole)) || 'billing';
  });

  const [adminProfile, setAdminProfile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile hamburger toggle
  const [desktopNavOpen, setDesktopNavOpen] = useState(false); // desktop hover-triggered flyout nav

  const toggleSidebar = () => {
    setSidebarOpen(o => !o);
    setDesktopNavOpen(o => !o);
  };

  useEffect(() => {
    api.get('/api/practitioner/profile')
      .then(res => { if (res.data) setAdminProfile(res.data); })
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
      default:
        return <BillingManager />;
    }
  };

  return (
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
            <h1 className="text-lg font-bold text-slate-800 tracking-tight leading-tight truncate">
              Progressive Steps<br/>
              <span className="text-sm font-medium text-slate-500">Admin Portal</span>
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

          {userRole === 'ceo' && (
            <a
              href={`${import.meta.env.BASE_URL}company-information.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l7-3 7 3z" />
              </svg>
              Company Information
            </a>
          )}

        </nav>

        <div className="p-4 border-t border-slate-100 flex flex-col items-center">
          <img src={izayaLogo} alt="Izaya" className="h-5 w-auto mb-1.5" />
          <p className="text-xs text-slate-700 text-center font-medium">Securely Powered by Izaya</p>
          <p className="text-[10px] text-slate-700 text-center font-medium tracking-wide uppercase mt-0.5">Early Intervention Simplified</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden print:h-auto print:overflow-visible print:block">
        <header className="print:hidden h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shadow-sm shrink-0 z-10">
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
            <div className="hidden sm:flex flex-col items-start gap-0.5">
              <img src={izayaLogo} alt="" className="h-5 w-auto" />
              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide leading-none whitespace-nowrap">Early Intervention Simplified</span>
            </div>
            <h2 className="text-base font-semibold text-slate-800 capitalize tracking-tight">
              {activeTab === 'practitioners' ? 'Staff Directory' : activeTab === 'reports' ? 'Master Reports' : 'Billing & Invoices'}
            </h2>
          </div>
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
                  {ROLE_LABELS[userRole] || 'Admin'}
                </span>
              </div>
            )}
            <button
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('role');
                navigate('/');
              }}
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
          {renderContent()}
        </div>
      </main>

    </div>
  );
};

export default AdminDashboard;
