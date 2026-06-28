import { useState } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const AdminReportFetcher = () => {
  const [searchType, setSearchType] = useState('practitioner_id');
  const [searchValue, setSearchValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerateMasterReport = async () => {
    if (!searchValue) {
      alert("Please enter an ID to generate the report for.");
      return;
    }

    setIsLoading(true);
    try {
      // We are sending a POST request to trigger the backend generation logic
      // This will handle the grouping, locking, PDF generation, and database entry
      const response = await api.post('/api/auth/admin/reports/generate', {
        practitionerId: searchValue, // Mapping your UI input to the controller
        targetMonth: '06', 
        targetYear: '2026'
      });

      if (response.data.success) {
        alert(`${response.data.message || "Reports generated successfully!"}`);
        // Refresh the page or trigger a state update here to show the new items in the Billing Manager
        window.location.reload(); 
      }
      
    } catch (error) {
      console.error("Failed to generate master reports", error);
      alert(error.response?.data?.error || "Failed to generate report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-md">
      <h3 className="text-lg font-bold text-slate-800 mb-4">Master Report Generator</h3>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Target Entity</Label>
          <select 
            className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
          >
            <option value="practitioner_id">Practitioner ID</option>
            {/* Logic for patient_id can be added later if needed */}
            <option value="patient_id" disabled>Patient ID (Coming Soon)</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>Identifier Value</Label>
          <Input 
            type="text" 
            placeholder={`Enter ${searchType.replace('_', ' ')}...`}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
          />
        </div>

        <Button 
          onClick={handleGenerateMasterReport} 
          disabled={isLoading}
          className="w-full bg-slate-900 text-white hover:bg-slate-800"
        >
          {isLoading ? 'Processing... (Locking Records)' : 'Fetch Official Report'}
        </Button>
      </div>
    </div>
  );
};