import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';

export const InvoiceHistory = () => {
  const [invoices, setInvoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInvoices = async () => {
    try {
      const response = await api.get('/api/billing/history'); 
      if (response.data.success) {
        setInvoices(response.data.invoices);
      }
    } catch (error) {
      console.error("Failed to fetch invoices", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  // Format the date safely without timezone shifting
  const formatSafeDate = (dateString) => {
    if (!dateString) return "N/A";
    const [year, month, day] = dateString.split('T')[0].split('-');
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  };

  // Helper to format file sizes nicely (e.g., 24.5 KB)
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Securely download the PDF using a temporary signed URL
  const handleDownload = async (fileName) => {
    try {
      const response = await api.get(`/api/billing/download?fileName=${encodeURIComponent(fileName)}`);
      if (response.data.success && response.data.signedUrl) {
        window.open(response.data.signedUrl, '_blank');
      }
    } catch (error) {
      console.error("Failed to download PDF", error);
      alert("Could not retrieve the invoice file.");
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading invoice vault...</div>;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full mt-8">
      
      {/* Header section */}
      <div className="px-7 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Invoice History & Vault</h3>
          <p className="text-sm text-slate-500 mt-1">Review and download generated PDFs directly from secure storage.</p>
        </div>
        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
          {invoices.length} Files
        </span>
      </div>

      {/* Table section */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <th className="py-4 px-6">Date Generated</th>
              <th className="py-4 px-6">File Name</th>
              <th className="py-4 px-6 text-right">File Size</th>
              <th className="py-4 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan="4" className="py-12 text-center text-slate-500 font-medium">
                  The billing bucket is currently empty.
                </td>
              </tr>
            ) : (
              invoices.map((file) => (
                <tr key={file.id} className="hover:bg-slate-50 transition-colors">
                  
                  {/* Date */}
                  <td className="py-4 px-6 font-medium text-slate-800 whitespace-nowrap">
                    {formatSafeDate(file.created_at)}
                  </td>
                  
                  {/* File Name */}
                  <td className="py-4 px-6 font-medium text-slate-700">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                      {file.name}
                    </div>
                  </td>
                  
                  {/* File Size */}
                  <td className="py-4 px-6 text-right font-medium text-slate-500">
                    {formatBytes(file.metadata?.size)}
                  </td>
                  
                  {/* Download Button */}
                  <td className="py-4 px-6 text-right">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleDownload(file.name)}
                      // 👇 Added cursor-pointer right here!
                      className="cursor-pointer text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2 ml-auto"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </Button>
                  </td>

                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};