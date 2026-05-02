/**
 * Stamped Document Generator — Phase 3.5
 *
 * Generates court-return artifacts exactly as a real Florida portal would:
 * 1. Stamped complaint PDF (with clerk stamp overlay)
 * 2. Confirmation receipt PDF
 * 3. Submission XML receipt
 */

import PDFDocument from 'pdfkit';
import type { FilingPacket, StampedDocument } from './courtFilingProvider';
import { generateECFXml } from './ecfXmlGenerator';

function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 9000) + 1000;
  return `${year}-CA-0${seq}-XXXX-MB`;
}

// ── Stamped Complaint PDF ─────────────────────────────────────────────────────
export async function generateStampedComplaint(
  packet: FilingPacket,
  submissionId: string,
  caseNumber: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Clerk stamp overlay (top-right)
    const stampX = doc.page.width - 220;
    const stampY = 30;
    doc.rect(stampX, stampY, 180, 100).strokeColor('#1a3a6b').lineWidth(2).stroke();
    doc.fillColor('#1a3a6b')
       .fontSize(7).font('Helvetica-Bold')
       .text('FILED', stampX + 10, stampY + 8, { width: 160, align: 'center' })
       .fontSize(7).font('Helvetica')
       .text(`15th Judicial Circuit Court`, stampX + 10, stampY + 20, { width: 160, align: 'center' })
       .text(`Palm Beach County, Florida`, stampX + 10, stampY + 30, { width: 160, align: 'center' })
       .fontSize(9).font('Helvetica-Bold')
       .text(`Case No: ${caseNumber}`, stampX + 10, stampY + 45, { width: 160, align: 'center' })
       .fontSize(7).font('Helvetica')
       .text(`Filed: ${new Date().toLocaleDateString('en-US')}`, stampX + 10, stampY + 60, { width: 160, align: 'center' })
       .text(`Submission: ${submissionId}`, stampX + 10, stampY + 72, { width: 160, align: 'center' })
       .fontSize(6)
       .text('SIMULATOR — NOT AN OFFICIAL COURT DOCUMENT', stampX + 10, stampY + 86, { width: 160, align: 'center' });

    // Gold header bar
    doc.rect(0, 0, doc.page.width, 6).fill('#CCA646');

    // Document content
    doc.fillColor('#000')
       .font('Helvetica-Bold').fontSize(12)
       .text('IN THE CIRCUIT COURT OF THE 15TH JUDICIAL CIRCUIT', { align: 'center' })
       .text('IN AND FOR PALM BEACH COUNTY, FLORIDA', { align: 'center' });

    doc.moveDown(1.5);

    const plaintiff = packet.parties.find(p => p.role === 'plaintiff');
    const defendant = packet.parties.find(p => p.role === 'defendant');

    doc.font('Helvetica-Bold').fontSize(10)
       .text(`${plaintiff?.name?.toUpperCase() || 'PLAINTIFF'},`)
       .font('Helvetica').text('      Plaintiff,')
       .moveDown(0.3)
       .text('v.')
       .moveDown(0.3)
       .font('Helvetica-Bold')
       .text(`${defendant?.name?.toUpperCase() || 'DEFENDANT'},`)
       .font('Helvetica').text('      Defendant.');

    doc.font('Helvetica').fontSize(10).moveDown(1)
       .text(`CASE NO.: ${caseNumber}`)
       .text('COMPLAINT AND DEMAND FOR JURY TRIAL');

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9).fillColor('#555')
       .text(`Document filed electronically via Florida Courts E-Filing Portal (Simulator).`)
       .text(`Submission ID: ${submissionId}`)
       .text(`Filed: ${new Date().toISOString()}`)
       .text(`Attorney: ${packet.submittedBy.name} — Bar No. ${packet.submittedBy.barNumber}`);

    // FILED stamp diagonal watermark
    doc.fillColor('#1a3a6b').opacity(0.04)
       .fontSize(80).font('Helvetica-Bold')
       .text('FILED', 0, doc.page.height / 2, { align: 'center', width: doc.page.width, rotate: -45 } as any);

    doc.end();
  });
}

// ── Confirmation Receipt PDF ──────────────────────────────────────────────────
export async function generateConfirmationReceipt(
  packet: FilingPacket,
  submissionId: string,
  caseNumber: string,
  fees: { filingFee: number; summonsFee: number; total: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 6).fill('#CCA646');

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(16)
       .text('E-FILING CONFIRMATION RECEIPT', { align: 'center' })
       .font('Helvetica').fontSize(9).fillColor('#555')
       .text('Florida Courts E-Filing Portal — Simulator', { align: 'center' });

    doc.moveDown(1.5);
    doc.fillColor('#000');

    const fields: [string, string][] = [
      ['Submission ID',       submissionId],
      ['Case Number',         caseNumber],
      ['Court',               'Circuit Court — 15th Judicial Circuit, Palm Beach County'],
      ['Filing Type',         packet.filingType.replace(/_/g, ' ').toUpperCase()],
      ['Case Type',           packet.caseType.replace(/_/g, ' ').toUpperCase()],
      ['Plaintiff',           packet.parties.find(p => p.role === 'plaintiff')?.name || '—'],
      ['Defendant',           packet.parties.find(p => p.role === 'defendant')?.name || '—'],
      ['Submitted By',        `${packet.submittedBy.name} (Bar: ${packet.submittedBy.barNumber})`],
      ['Documents Filed',     packet.documents.length.toString()],
      ['Filing Fee',          `$${fees.filingFee.toFixed(2)}`],
      ['Summons Fee',         `$${fees.summonsFee.toFixed(2)}`],
      ['Total Paid',          `$${fees.total.toFixed(2)}`],
      ['Status',              'ACCEPTED'],
      ['Filed At',            new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' EST'],
    ];

    for (const [label, value] of fields) {
      doc.font('Helvetica-Bold').fontSize(9).text(label + ':', { continued: true })
         .font('Helvetica').fontSize(9).text('  ' + value);
      doc.moveDown(0.4);
    }

    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8).fillColor('#888')
       .text('⚠ SIMULATOR DOCUMENT — Not an official court record. This document was generated by the Yaffa Law Court Filing Simulator for development and demonstration purposes only.');

    doc.end();
  });
}

// ── Build full StampedDocument return set ─────────────────────────────────────
export async function generateStampedDocumentSet(
  packet: FilingPacket,
  submissionId: string,
  fees: { filingFee: number; summonsFee: number; total: number }
): Promise<{
  caseNumber: string;
  documents: StampedDocument[];
  buffers: Record<string, Buffer>;
}> {
  const caseNumber = generateCaseNumber();
  const stampedAt  = new Date().toISOString();

  const [stampedPdf, receiptPdf] = await Promise.all([
    generateStampedComplaint(packet, submissionId, caseNumber),
    generateConfirmationReceipt(packet, submissionId, caseNumber, fees),
  ]);

  const ecfXml = Buffer.from(generateECFXml(packet, submissionId));

  const documents: StampedDocument[] = [
    {
      documentId:  `${submissionId}-STAMPED`,
      type:        'stamped_complaint',
      fileName:    `stamped_complaint_${submissionId}.pdf`,
      base64:      stampedPdf.toString('base64'),
      stampedAt,
      caseNumber,
      division:    'Civil Division — MB',
    },
    {
      documentId:  `${submissionId}-RECEIPT`,
      type:        'confirmation_receipt',
      fileName:    `confirmation_receipt_${submissionId}.pdf`,
      base64:      receiptPdf.toString('base64'),
      stampedAt,
      caseNumber,
    },
    {
      documentId:  `${submissionId}-XML`,
      type:        'submission_xml',
      fileName:    `submission_${submissionId}.xml`,
      base64:      ecfXml.toString('base64'),
      stampedAt,
      caseNumber,
    },
  ];

  return {
    caseNumber,
    documents,
    buffers: {
      stamped: stampedPdf,
      receipt: receiptPdf,
      xml:     ecfXml,
    },
  };
}
