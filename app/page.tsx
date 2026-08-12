import type { Metadata } from "next";
import { GameShell } from "./game/GameShell";

export const metadata: Metadata = {
  title: "Wayfarer — Trade the city",
  description:
    "A location-powered space trading game. Follow market rumors, dock at nearby starports, and build your ship.",
};

export default function Home() {
  return <GameShell />;
}
