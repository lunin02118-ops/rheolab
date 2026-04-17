import { Navigate } from 'react-router-dom';

export default function ReagentsPage() {
    return <Navigate to="/dashboard/library?tab=reagents" replace />;
}
