import { useState, useRef } from "react";
import html2canvas from "html2canvas";

type Result = {
  brand: string;
  category: string;
  returnWindow: string;
  refundType: string;
  returnMethod: string;
  costs: string;
  conditions: string[];
  riskScore: string;
  riskLevel: "green" | "yellow" | "red";
  benchmark: string;
  tip: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Normalize URL (ensure it has https://)
  const normalizeUrl = (raw: string) => {
    let u = raw
