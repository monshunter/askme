import { apiData, requestId } from "@/server/http";

export function GET(request: Request) {
  const id = requestId(request);
  return apiData({ status: "live", service: "askme-web" }, id);
}
