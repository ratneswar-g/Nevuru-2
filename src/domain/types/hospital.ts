export interface HospitalDestination {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  specialties?: string[];
  contactPhone?: string;
  entranceOrDepartment?: string;
  accessNotes?: string;
  emergencyContactPhone?: string;
}
