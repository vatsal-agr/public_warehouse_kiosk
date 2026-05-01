import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Matches movements / kiosk flow: challan id, display date & time, direction, optional notes string. */
export type ChallanTransactionData = {
  challan_number: string;
  date: string;
  time: string;
  transaction_type: "IN" | "OUT" | "MIXED";
  notes?: string | null;
  /**
   * From `venues.contact_info` (e.g. `phone | address`) when notes do not include walk-in triple.
   * Fills PDF "Mob." / address for saved Walk-In customers and venues with contact on file.
   */
  client_phone?: string | null;
  client_address?: string | null;
};

export type ChallanCartLine = {
  name: string;
  quantity: number;
};

const PAGE_MARGIN_MM = 12;
const ADDRESS_LINE = "Address";
const GSTIN_DERA = "GSTIN";
const BILLING_DERA = "Entity Name";
const MOB_TENT = "Ph. No";
const MOB_DERA = "Ph. No.";

type ClientBlock = {
  msName: string;
  address: string;
  mob: string;
};

/** Same format as stored in `venues.contact_info` when saving walk-ins: first segment = phone, rest = address. */
export function splitVenueContactInfo(contactInfo: string | null | undefined): {
  phone: string;
  address: string;
} {
  const s = (contactInfo ?? "").trim();
  if (!s) return { phone: "", address: "" };
  const parts = s.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return { phone: "", address: "" };
  return {
    phone: parts[0] ?? "",
    address: parts.length > 1 ? parts.slice(1).join(" | ") : "",
  };
}

/** Parse walk-in notes (Name: | Phone: | Address:) or fall back to venue + free-text notes; merge venue contact. */
function parseBillBookClient(
  venueName: string,
  notes?: string | null,
  extras?: { phone?: string | null; address?: string | null } | null,
): ClientBlock {
  const v = (venueName ?? "").trim() || "—";
  const raw = notes?.trim() ?? "";
  let block: ClientBlock;

  if (!raw) {
    block = { msName: v, address: "—", mob: "" };
  } else {
    const segments = raw.split("|").map((s) => s.trim());
    let name = "";
    let phone = "";
    let addr = "";
    for (const seg of segments) {
      const mName = seg.match(/^name:\s*(.+)$/i);
      const mPhone = seg.match(/^phone:\s*(.+)$/i);
      const mAddr = seg.match(/^address:\s*([\s\S]+)$/i);
      if (mName) name = mName[1].trim();
      if (mPhone) phone = mPhone[1].trim();
      if (mAddr) addr = mAddr[1].trim();
    }

    if (name || phone || addr) {
      block = {
        msName: name || v,
        address: addr || "—",
        mob: phone,
      };
    } else {
      block = { msName: v, address: raw, mob: "" };
    }
  }

  const exPhone = (extras?.phone ?? "").trim();
  const exAddr = (extras?.address ?? "").trim();
  if (!block.mob && exPhone) {
    block = { ...block, mob: exPhone };
  }
  if (exAddr && (block.address === "—" || block.address.trim() === "")) {
    block = { ...block, address: exAddr };
  }

  return block;
}

function headerMobile(billingEntity: string | null | undefined): string {
  return billingEntity?.trim() === BILLING_DERA ? MOB_DERA : MOB_TENT;
}

function billingTitle(billingEntity: string | null | undefined): string {
  const t = billingEntity?.trim();
  return t && t.length > 0 ? t : "Lallooji Tent Wale";
}

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

function documentHeaderTitle(transactionType: ChallanTransactionData["transaction_type"]): string {
  if (transactionType === "IN") return "Receiving Challan";
  if (transactionType === "OUT") return "Delivery Challan";
  return "Delivery Challan";
}

function referenceLineLabel(transactionType: ChallanTransactionData["transaction_type"]): string {
  return transactionType === "IN" ? "Reference:" : "Challan No:";
}

/**
 * Traditional Indian bill-book style delivery / receiving challan PDF (browser download).
 */
export function generateChallanPDF(
  transactionData: ChallanTransactionData,
  cartItems: ChallanCartLine[],
  venueName: string,
  billingEntity?: string | null,
): void {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const innerRight = pageW - PAGE_MARGIN_MM;
  const innerW = pageW - 2 * PAGE_MARGIN_MM;
  const gapMm = 4;
  const colW = (innerW - gapMm) / 2;
  const pad = 3;
  const labelW = 22;

  const title = billingTitle(billingEntity);
  const isDera = billingEntity?.trim() === BILLING_DERA;
  const mobDisplay = headerMobile(billingEntity);
  const client = parseBillBookClient(venueName, transactionData.notes, {
    phone: transactionData.client_phone,
    address: transactionData.client_address,
  });

  let y = PAGE_MARGIN_MM;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.setTextColor(0, 0, 0);

  const headerTitle = documentHeaderTitle(transactionData.transaction_type);

  // —— Header row: Delivery / Receiving Challan (left) | Mob (right) ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(headerTitle, PAGE_MARGIN_MM, y);
  doc.text(`Mob.: ${mobDisplay}`, innerRight, y, { align: "right" });
  y += 8;

  // —— Main title (billing entity) ——
  doc.setFontSize(20);
  doc.text(title, pageW / 2, y, { align: "center", maxWidth: innerW });
  y += 10;

  // —— Address ——
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(ADDRESS_LINE, pageW / 2, y, { align: "center" });
  y += 6;

  // —— Conditional GSTIN ——
  if (isDera) {
    doc.setFontSize(9);
    doc.text(`GSTIN: ${GSTIN_DERA}`, pageW / 2, y, { align: "center" });
    y += 7;
  } else {
    y += 2;
  }

  // —— Split section: client (left) | challan box (right) ——
  const leftX = PAGE_MARGIN_MM;
  const rightX = PAGE_MARGIN_MM + colW + gapMm;
  const boxTop = y;

  let ly = boxTop + pad + 4;

  doc.setFontSize(9);
  const lineMs = `M/s / Name: ${client.msName}`;
  const lineAddrLabel = "Address:";
  const mobText = `Mob.: ${(client.mob || "").trim() || "—"}`;

  const addrValueLines = doc.splitTextToSize(client.address, colW - pad * 2 - labelW - 1);
  const msLines = doc.splitTextToSize(lineMs, colW - pad * 2);
  const mobLines = doc.splitTextToSize(mobText, colW - pad * 2);
  const lineHeight = 4.2;
  let leftContentH = pad * 2 + 4;
  leftContentH += msLines.length * lineHeight;
  leftContentH += 2 + addrValueLines.length * lineHeight + 2;
  leftContentH += mobLines.length * lineHeight;

  const rightLines = 3;
  const rightBoxH = pad * 2 + 4 + rightLines * 6 + 4;
  const sectionH = Math.max(leftContentH, rightBoxH, 42);

  doc.rect(leftX, boxTop, colW, sectionH);
  doc.rect(rightX, boxTop, colW, sectionH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(msLines, leftX + pad, ly);
  ly += msLines.length * 4.2 + 2;

  doc.text(lineAddrLabel, leftX + pad, ly);
  doc.setFont("helvetica", "normal");
  doc.text(addrValueLines, leftX + pad + labelW, ly);
  ly += addrValueLines.length * lineHeight + 2;

  doc.setFont("helvetica", "bold");
  doc.text(mobLines, leftX + pad, ly);

  // Right box: challan info
  let ry = boxTop + pad + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(
    `${referenceLineLabel(transactionData.transaction_type)} ${transactionData.challan_number}`,
    rightX + pad,
    ry,
  );
  ry += 6;
  doc.text("Order No: ____________", rightX + pad, ry);
  ry += 6;
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${transactionData.date}`, rightX + pad, ry);

  y = boxTop + sectionH + 6;

  // —— Table —— (alphabetical by item name; qty always positive on paper)
  const sortedLines = [...cartItems].sort((a, b) => a.name.localeCompare(b.name));
  const bodyRows = sortedLines.map((item, i) => {
    const q = Number(item.quantity);
    const displayQty = Number.isFinite(q) ? Math.abs(q) : 0;
    return [String(i + 1), item.name, String(displayQty)];
  });

  autoTable(doc, {
    startY: y,
    head: [["S.No.", "Particulars / Item", "Qty"]],
    body: bodyRows.length > 0 ? bodyRows : [["—", "No line items", "—"]],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: "middle",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: 0,
      fontStyle: "bold",
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      halign: "center",
    },
    margin: { left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM },
    tableWidth: innerW,
    columnStyles: {
      0: { halign: "center", cellWidth: 14 },
      1: { halign: "left", cellWidth: "auto" },
      2: { halign: "center", cellWidth: 18 },
    },
  });

  const d = doc as DocWithAutoTable;
  let footerY = (d.lastAutoTable?.finalY ?? y) + 14;

  if (footerY > pageH - 28) {
    doc.addPage();
    footerY = PAGE_MARGIN_MM + 20;
  }

  const sigLineW = 65;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.line(PAGE_MARGIN_MM, footerY, PAGE_MARGIN_MM + sigLineW, footerY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Customer Signature", PAGE_MARGIN_MM, footerY + 5);

  doc.line(innerRight - sigLineW, footerY, innerRight, footerY);
  doc.text(`For ${title}`, innerRight, footerY + 5, { align: "right" });

  const safeFileId = String(transactionData.challan_number).replace(/[^\w.-]+/g, "_");
  const filePrefix = transactionData.transaction_type === "IN" ? "Receiving" : "Delivery";
  doc.save(`${filePrefix}-${safeFileId}.pdf`);
}
