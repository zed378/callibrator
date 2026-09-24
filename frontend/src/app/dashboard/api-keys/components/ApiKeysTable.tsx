// src/app/dashboard/api-keys/components/ApiKeysTable.tsx
import React, { useState } from "react";
import { ApiKey } from "@/api/services/apiKey.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Pagination,
} from "@/components/ui";
import { KeyRound, Ban } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface ApiKeysTableProps {
  apiKeys: PaginatedResponse<ApiKey> | null;
  isApiKeysLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  handleRevokeClick: (apiKey: ApiKey) => void;
}

const asNode = (value: unknown) => value as React.ReactNode;

const MAX_SCOPE_CHIPS = 3;

/**
 * A key's display status at `now` (epoch ms): revoked (inactive) wins over
 * expired, and a key with no expiry never expires.
 */
export const apiKeyStatus = (
  apiKey: Pick<ApiKey, "isActive" | "expiresAt">,
  now: number,
): "active" | "expired" | "revoked" => {
  if (!apiKey.isActive) return "revoked";
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) {
    return "expired";
  }
  return "active";
};

export const ApiKeysTable: React.FC<ApiKeysTableProps> = ({
  apiKeys,
  isApiKeysLoading,
  pageSize,
  setCurrentPage,
  handleRevokeClick,
}) => {
  // The clock is read once, when the table mounts — not on every render
  // (react-hooks/purity: Date.now() during render is not idempotent). A key
  // that expires while the page is open shows as expired after the next list
  // refresh remounts the rows.
  const [now] = useState(Date.now);

  const getStatusBadge = (apiKey: ApiKey) => {
    const status = apiKeyStatus(apiKey, now);
    if (status === "active") {
      return <Badge variant="success">Active</Badge>;
    }
    if (status === "expired") {
      return <Badge variant="danger">Expired</Badge>;
    }
    return <Badge variant="danger">Revoked</Badge>;
  };

  const renderScopes = (scopes: string[]) => {
    const visible = scopes.slice(0, MAX_SCOPE_CHIPS);
    const remaining = scopes.length - visible.length;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((scope) => (
          <Badge key={scope} variant="primary" size="sm">
            {scope}
          </Badge>
        ))}
        {remaining > 0 && (
          <Badge variant="default" size="sm">
            +{remaining}
          </Badge>
        )}
      </div>
    );
  };

  const columns = [
    { key: "name", header: "Name", render: asNode },
    { key: "key", header: "Key", render: asNode },
    { key: "scopes", header: "Scopes", render: asNode },
    { key: "status", header: "Status", render: asNode },
    { key: "lastUsed", header: "Last Used", render: asNode },
    { key: "expires", header: "Expires", render: asNode },
    { key: "actions", header: "Actions", render: asNode },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isApiKeysLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !apiKeys || apiKeys.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No API keys yet</p>
            <p className="text-sm">
              Create an API key to integrate external systems.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={apiKeys.data.map((apiKey: ApiKey) => ({
                id: apiKey.id,
                name: (
                  <div className="font-semibold text-foreground">
                    {apiKey.name}
                  </div>
                ),
                key: (
                  <code className="font-mono text-xs text-muted-foreground">
                    {apiKey.keyPrefix}
                    {"••••"}
                  </code>
                ),
                scopes: renderScopes(apiKey.scopes || []),
                status: getStatusBadge(apiKey),
                lastUsed: apiKey.lastUsedAt ? (
                  <span className="text-sm">
                    {new Date(apiKey.lastUsedAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                ),
                expires: apiKey.expiresAt ? (
                  <span className="text-sm">
                    {new Date(apiKey.expiresAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                ),
                actions: (
                  <div className="flex items-center gap-2">
                    {apiKeyStatus(apiKey, now) === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeClick(apiKey)}
                        className="text-destructive hover:text-destructive hover:bg-muted flex items-center gap-1"
                      >
                        <Ban className="h-4 w-4" />
                        Revoke
                      </Button>
                    )}
                  </div>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={apiKeys.meta.page}
                totalPages={apiKeys.meta.totalPages}
                totalItems={apiKeys.meta.total ?? 0}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ApiKeysTable;
