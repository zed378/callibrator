import React from "react";
import { Card, CardContent } from "@/components/ui";
import { Award, CheckCircle, Clock, AlertTriangle } from "lucide-react";

interface CalibrationStatsProps {
  stats: any;
}

export const CalibrationStats: React.FC<CalibrationStatsProps> = ({ stats }) => {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="bg-card border-border">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase">Total Certs</p>
            <p className="text-2xl font-bold text-foreground mt-1">{stats.totalCertificates}</p>
          </div>
          <Award className="h-8 w-8 text-primary opacity-80" />
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase">Digitally Signed</p>
            <p className="text-2xl font-bold text-foreground mt-1">{stats.byStatus?.signed || 0}</p>
          </div>
          <CheckCircle className="h-8 w-8 text-success opacity-80" />
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase">Awaiting Signatures</p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {(stats.byStatus?.pending_approval || 0) + (stats.byStatus?.approved || 0)}
            </p>
          </div>
          <Clock className="h-8 w-8 text-warning opacity-80" />
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase">Revoked Certs</p>
            <p className="text-2xl font-bold text-foreground mt-1">{stats.byStatus?.revoked || 0}</p>
          </div>
          <AlertTriangle className="h-8 w-8 text-destructive opacity-80" />
        </CardContent>
      </Card>
    </div>
  );
};

export default CalibrationStats;
