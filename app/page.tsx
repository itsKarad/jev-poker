import { connection } from "next/server";
import { PokerDashboard } from "@/components/poker-dashboard";
import { getPlayerModels } from "@/lib/player-models";

export default async function HomePage() {
  await connection();
  return <PokerDashboard models={getPlayerModels()} />;
}
