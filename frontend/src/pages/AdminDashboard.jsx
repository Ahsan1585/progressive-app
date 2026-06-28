import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { MasterReports } from '@/components/MasterReports';
import { BillingManager } from '@/components/BillingManager';
import { RegisterPractitionerForm } from '@/components/RegisterPractitionerForm';

const TAB_ACCESS = {
  practitioners: ['ceo', 'staff_director'],
  reports:       ['ceo'],
  billing:       ['ceo', 'billing'],
};

const ROLE_LABELS = {
  ceo:            'CEO',
  staff_director: 'Staff Director',
  billing:        'Billing',
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const userRole = localStorage.getItem('role');

  const visibleTabs = Object.keys(TAB_ACCESS).filter(tab => TAB_ACCESS[tab].includes(userRole));

  const [activeTab, setActiveTab] = useState(() => {
    return Object.keys(TAB_ACCESS).find(tab => TAB_ACCESS[tab].includes(userRole)) || 'billing';
  });

  const [adminProfile, setAdminProfile] = useState(null);

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
          <div className="max-w-3xl mx-auto">
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
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">

      {/* SIDEBAR */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-full shadow-sm z-10">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-blue-600 animate-pulse"></span>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight leading-tight">
              Progressive Steps<br/>
              <span className="text-sm font-medium text-slate-500">Admin Portal</span>
            </h1>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">

          {visibleTabs.includes('practitioners') && (
            <button
              onClick={() => setActiveTab('practitioners')}
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
              onClick={() => setActiveTab('reports')}
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
              onClick={() => setActiveTab('billing')}
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

        <div className="p-4 border-t border-slate-100">
          <p className="text-xs text-slate-400 text-center font-medium">Progressive Steps NJ</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm shrink-0 z-10">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse"></span>
            <h2 className="text-base font-semibold text-slate-800 capitalize tracking-tight">
              {activeTab === 'practitioners' ? 'Staff Directory' : activeTab === 'reports' ? 'Master Reports' : 'Billing & Invoices'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {adminProfile && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
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
              className="text-sm font-medium text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg transition-all"
            >
              Sign Out
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {renderContent()}
        </div>
      </main>

    </div>
  );
};

export default AdminDashboard;
