import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResumeProfileDialog } from "../ResumeProfileDialog";
import { intakeGet, intakeMutate } from "../../lib/resumeIntakeApi";
vi.mock("../../lib/resumeIntakeApi", () => ({
  intakeGet: vi.fn(),
  intakeMutate: vi.fn(),
  intakeDownload: vi.fn(),
  intakeBlob: vi.fn(),
}));
const caps = { canUpload: true, canDownload: true, canAssign: false } as any;
const item = {
  itemId: "file",
  batchId: "batch",
  fileName: "resume.docx",
  status: "processing",
  revision: 1,
  profile: { name: "", email: "", phone: "", skills: [] },
} as any;
beforeEach(() => vi.resetAllMocks());

it("populates a profile opened before parsing finishes with the revealed extraction", async () => {
  vi.mocked(intakeGet).mockResolvedValue({
    ...item,
    status: "review_required",
    profile: { name: "Parsed Candidate", email: "p***@example.test" },
  });
  vi.mocked(intakeMutate).mockResolvedValue({
    ...item,
    status: "review_required",
    profile: {
      name: "Parsed Candidate",
      email: "parsed@example.test",
      phone: "",
      skills: ["Python"],
    },
  });
  render(
    <ResumeProfileDialog
      item={item}
      caps={caps}
      jobs={[]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Candidate name")).toHaveValue("");
  await waitFor(
    () =>
      expect(screen.getByLabelText("Email")).toHaveValue("parsed@example.test"),
    { timeout: 5000 },
  );
  expect(screen.getByLabelText("Candidate name")).toHaveValue(
    "Parsed Candidate",
  );
  expect(intakeMutate).toHaveBeenCalledWith("/items/file/reveal", {});
});

it("allows loading older resume versions instead of hiding history after the first page", async () => {
  vi.mocked(intakeGet).mockImplementation(async (path) =>
    path.includes("skip=1")
      ? {
          items: [
            {
              ...item,
              itemId: "older",
              fileName: "older.docx",
              status: "completed",
            },
          ],
          hasMore: false,
        }
      : ({
          items: [
            {
              ...item,
              itemId: "newer",
              fileName: "newer.docx",
              status: "completed",
            },
          ],
          hasMore: true,
        } as any),
  );
  render(
    <ResumeProfileDialog
      item={{ ...item, status: "completed" }}
      caps={{ ...caps, canUpload: false }}
      jobs={[]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Resume versions you can access"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more resume versions" }),
  );
  expect(await screen.findByText("older.docx")).toBeInTheDocument();
  expect(screen.getByText("newer.docx")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load more resume versions" }),
  ).not.toBeInTheDocument();
});
