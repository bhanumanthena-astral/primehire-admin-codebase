import { test, expect, Page } from "@playwright/test";
async function login(page: Page, email = "admin@example.com") {
  await page.goto("/login");
  await page.getByPlaceholder("Enter Email / Phone No").fill(email);
  await page.getByPlaceholder("Passcode").fill("Browser-test-only-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (email === "admin@example.com" || email === "recruiter@example.com")
    await page.getByRole("button", { name: /^Recruitment Tracker/ }).click();
  else {
    await expect(page.getByRole('region',{name:'Your interview overview'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Recruitment roadmap'})).toHaveCount(0);
    await page.screenshot({path:`test-results/recruitment/${email.split('@')[0]}-overview.png`,fullPage:true});
    if (email === 'managerial_interviewer@example.com') {
      await page.evaluate(()=>document.documentElement.classList.add('dark'));
      await page.screenshot({path:'test-results/recruitment/managerial-overview-dark.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.screenshot({path:'test-results/recruitment/managerial-overview-mobile.png',fullPage:true});
      await page.evaluate(()=>document.documentElement.classList.remove('dark'));
      await page.setViewportSize({width:1280,height:720});
    }
    await page.getByRole('button',{name:'My interviews',exact:true}).click();
  }
}
test("recruiter schedules manually and sees shared calendar and professional invitation", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Recruitment workspace" }),
  ).toBeVisible();
  await page
    .getByLabel("Search recruitment candidates")
    .fill("Interview Candidate 0");
  await page
    .getByRole("article")
    .filter({ hasText: "Interview Candidate 0" })
    .getByRole("button", { name: "Schedule interview", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Assigned interviewer").click();
  await page.getByRole("option", { name: "Rahul Demo" }).click();
  await expect(dialog.getByText(/Rahul Demo has not connected Google Calendar/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Check availability'})).toHaveCount(0);
  const start = new Date(Date.now() + 86400000 * 5);
  const ist = new Date(start.getTime() + 330 * 60000)
    .toISOString()
    .slice(0, 16);
  const end = new Date(start.getTime() + 390 * 60000)
    .toISOString()
    .slice(0, 16);
  await dialog.getByLabel("Interview starts").fill(ist);
  await dialog.getByLabel("Interview ends").fill(end);
  await dialog
    .getByLabel("Scheduling reason")
    .fill("Recruiter approved this technical interview");
  await dialog
    .getByRole("button", { name: "Schedule interview", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const bookedCard=page.getByRole('article').filter({hasText:'Interview Candidate 0'});
  await expect(bookedCard.getByRole('region',{name:'Scheduled interview'})).toContainText('Rahul Demo');
  await expect(bookedCard.getByRole('button',{name:'Schedule interview',exact:true})).toHaveCount(0);
  await bookedCard.getByRole('button',{name:'Candidate roadmap',exact:true}).click();
  const roadmap=page.getByRole('region',{name:'Candidate roadmap',exact:true});
  await expect(roadmap.getByRole('heading',{name:'Interview Candidate 0',exact:true})).toBeVisible();
  await expect(roadmap.getByRole('list',{name:'Candidate recruitment history'})).toContainText('Recruiter approved this technical interview');
  const roadmapRect=(await roadmap.boundingBox())!;
  const mainRect=(await page.locator('#main-content').boundingBox())!;
  expect(Math.abs(roadmapRect.x+roadmapRect.width/2-mainRect.x-mainRect.width/2)).toBeLessThan(3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  const mobileRoadmapRect=(await roadmap.boundingBox())!;
  expect(Math.abs(mobileRoadmapRect.x+mobileRoadmapRect.width/2-195)).toBeLessThan(3);
  const mobileContentWidth=await page.locator('#main-content').evaluate(element=>{
    const style=getComputedStyle(element);
    return element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  });
  expect(Math.abs(mobileRoadmapRect.width-mobileContentWidth)).toBeLessThan(2);
  await page.screenshot({path:'test-results/recruitment/candidate-roadmap-mobile.png',fullPage:true});
  await roadmap.getByRole('button',{name:'Back to overview'}).click();
  await expect(roadmap).not.toBeVisible();
  await expect(bookedCard.getByRole('button',{name:'Candidate roadmap',exact:true})).toBeFocused();
  await page.setViewportSize({width:1280,height:720});
  await bookedCard.getByRole('button',{name:'Reschedule interview',exact:true}).click();
  const revisedStart=new Date(start.getTime()+86400000);
  const revisedIst=new Date(revisedStart.getTime()+330*60000).toISOString().slice(0,16);
  const revisedEnd=new Date(revisedStart.getTime()+390*60000).toISOString().slice(0,16);
  const reschedule=page.getByRole('dialog');
  await reschedule.getByLabel('Interview starts').fill(revisedIst);
  await reschedule.getByLabel('Interview ends').fill(revisedEnd);
  await reschedule.getByLabel('Rescheduling reason').fill('Candidate requested a later interview slot');
  await reschedule.getByRole('button',{name:'Save new schedule',exact:true}).click();
  await expect(reschedule).not.toBeVisible();
  await expect(bookedCard).toContainText('Candidate requested a later interview slot');
  await page
    .getByRole("button", { name: "Shared calendar", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Interview Candidate 0/ })
    .first()
    .click();
  const detail = page.getByRole("region",{name:"Interview Candidate 0 interview workspace"});
  await detail.getByRole("tab", { name: "Schedule & delivery" }).click();
  await expect(detail.getByRole('region',{name:'Rescheduling history'})).toContainText('Candidate requested a later interview slot');
  const download = page.waitForEvent("download");
  await detail
    .getByRole("button", { name: "Professional invitation PDF" })
    .click();
  expect((await download).suggestedFilename()).toBe("interview-invitation.pdf");
  await page.screenshot({
    path: "test-results/recruitment/scheduling.png",
    fullPage: true,
  });
});
test("technical reviewer sees assigned candidate, submits locked review and has responsive layout", async ({
  page,
}) => {
  await login(page, "technical_interviewer@example.com");
  await expect(
    page.getByRole("heading", { name: "Technical Interview Portal" }),
  ).toBeVisible();
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({path:'test-results/recruitment/technical-overview-dark.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await page.getByLabel("Interview view filter").click();
  await page
    .getByRole("option", { name: "Pending reviews", exact: true })
    .click();
  const card = page
    .getByRole("article")
    .filter({ hasText: "Interview Candidate 1" });
  await card.getByRole("button", { name: "View candidate & review" }).click();
  const dialog = page.getByRole("region",{name:"Interview Candidate 1 interview workspace"});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1200);
  await dialog.getByRole('button',{name:'Back to interviews'}).click();
  await expect(card.getByRole('button',{name:'View candidate & review'})).toBeFocused();
  await card.getByRole('button',{name:'View candidate & review'}).click();
  await expect(
    dialog.getByText("Assessment score", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Reviews & decision" }).click();
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({width, height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const strengths = dialog.getByLabel('Candidate strengths');
    const spacing = await strengths.evaluate(input => {
      const label = input.closest('label')!;
      const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
      const range = document.createRange(); range.selectNode(text);
      return input.getBoundingClientRect().top - range.getBoundingClientRect().bottom;
    });
    expect(spacing).toBeGreaterThanOrEqual(6);
    await page.screenshot({path:`test-results/recruitment/review-alignment-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1280,height:720});
  await dialog.getByRole('combobox',{name:'Technical depth rating'}).click();
  await page.getByRole('option',{name:'5 / 5',exact:true}).click();
  await dialog
    .getByLabel("Candidate strengths")
    .fill("Strong Python knowledge and clear explanations");
  await dialog
    .getByLabel("Review reasons")
    .fill("Proceed to the managerial interview based on demonstrated skills");
  await dialog
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  const success=page.getByRole('heading',{name:'Review submitted successfully'});
  await expect(success).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Recruitment workspace'}).getByRole('button',{name:'My interviews',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByText('Congratulations, Rahul!',{exact:false})).toBeVisible();
  const illustration=page.getByRole('img',{name:'A friendly 3D colleague showing appreciation'});
  await expect(illustration).toBeVisible();
  await expect.poll(()=>illustration.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(page.getByLabel('Interview view filter')).toContainText('Completed reviews');
  await page.screenshot({path:'test-results/recruitment/review-submission-success.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await page.screenshot({path:'test-results/recruitment/review-submission-success-dark.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/recruitment/review-submission-success-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:720});
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await page.getByRole('button',{name:'View submitted review',exact:true}).click();
  await expect(dialog.getByText(/Submitted .*locked/)).toBeVisible();
  const ratings=dialog.getByRole('region',{name:'Technical review ratings'});
  await expect(ratings).toContainText('Technical depth');
  await expect(ratings).toContainText('5/ 5');
  const ratingY=(await ratings.boundingBox())!.y;
  expect(ratingY).toBeLessThan((await dialog.getByText('Strong Python knowledge and clear explanations',{exact:false}).boundingBox())!.y);
  await page.screenshot({path:'test-results/recruitment/technical-review-workspace.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(ratings).toBeVisible();
  await page.screenshot({path:'test-results/recruitment/technical-review-workspace-dark.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const rect = (await dialog.boundingBox())!;
  expect(rect.width).toBe(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({
    path: "test-results/recruitment/technical-mobile.png",
    fullPage: true,
  });
});
test("managerial portal has assigned work and review decisions", async ({
  page,
}) => {
  await login(page, "managerial_interviewer@example.com");
  await expect(
    page.getByRole("heading", { name: "Managerial Interview Portal" }),
  ).toBeVisible();
  await page.getByLabel("Interview view filter").click();
  await page
    .getByRole("option", { name: "Pending reviews", exact: true })
    .click();
  await page
    .getByRole("article")
    .filter({ hasText: "Interview Candidate 2" })
    .getByRole("button", { name: "View candidate & review" })
    .click();
  const workspace=page.getByRole('region',{name:'Interview Candidate 2 interview workspace'});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await workspace.boundingBox())!.width).toBeGreaterThan(1200);
  await workspace.getByRole("tab", { name: "Reviews & decision" }).click();
  await expect(workspace.getByRole('group',{name:'Your ratings'})).toBeVisible();
  await expect(workspace.getByRole('combobox',{name:'Leadership rating'})).toBeVisible();
  await page.screenshot({path:'test-results/recruitment/manager-review-workspace.png',fullPage:true});
  await expect(
    page.getByRole("button", { name: "Submit review" }),
  ).toBeVisible();
});
test("HR generates ten questions, records answer and compensation", async ({
  page,
}) => {
  await login(page, "hr@example.com");
  await expect(
    page.getByRole("heading", { name: "HR Interview Portal" }),
  ).toBeVisible();
  await page.getByLabel("Interview view filter").click();
  await page
    .getByRole("option", { name: "Pending reviews", exact: true })
    .click();
  const hrCard=page.getByRole('article').filter({hasText:'Interview Candidate 3'});
  await hrCard.getByRole('button',{name:'Candidate roadmap',exact:true}).click();
  const profilePage=page.getByRole('region',{name:'Candidate roadmap',exact:true});
  await expect(profilePage.getByRole('heading',{name:'Interview Candidate 3',exact:true})).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'HR Interview Portal'})).toHaveCount(0);
  expect((await profilePage.boundingBox())!.width).toBeGreaterThan(1200);
  await page.setViewportSize({width:390,height:844});
  expect((await profilePage.boundingBox())!.width).toBe(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/recruitment/hr-candidate-profile-mobile.png',fullPage:true});
  await profilePage.getByRole('button',{name:'View interview & review'}).click();
  const profileReview=page.getByRole('region',{name:'Interview Candidate 3 interview workspace'});
  await expect(profileReview).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await profileReview.getByRole('button',{name:'Back to interviews'}).click();
  await expect(hrCard.getByRole('button',{name:'View candidate & review'})).toBeFocused();
  await page.setViewportSize({width:1920,height:1080});
  await page
    .getByRole("article")
    .filter({ hasText: "Interview Candidate 3" })
    .getByRole("button", { name: "View candidate & review" })
    .click();
  const dialog = page.getByRole('region',{name:'Interview Candidate 3 interview workspace'});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1880);
  await dialog.getByRole('tab',{name:'Reviews & decision'}).click();
  await expect(dialog.getByRole('group',{name:'Your ratings'})).toBeVisible();
  await page.screenshot({path:'test-results/recruitment/hr-review-workspace.png',fullPage:true});
  await dialog.getByRole("tab", { name: "HR questions" }).click();
  await dialog.getByRole("button", { name: "Generate 10 HR questions" }).click();
  await expect(dialog.getByLabel("Question 10", { exact: true })).toBeVisible();
  await dialog
    .getByLabel("Answer 1", { exact: true })
    .fill("Candidate explained a clear improvement plan.");
  await dialog.getByRole("button", { name: "Save answer" }).first().click();
  await expect(dialog.getByText("Answer saved.")).toBeVisible();
  await dialog.getByRole("tab", { name: "Offer & negotiation" }).click();
  await dialog.getByLabel("Proposed offer", { exact: true }).fill("1200000");
  await dialog
    .getByLabel("Compensation reason")
    .fill("Annual compensation proposal discussed");
  await dialog.getByRole("button", { name: "Save compensation" }).click();
  await expect(dialog.getByText("Compensation saved.")).toBeVisible();
  await page.screenshot({
    path: "test-results/recruitment/hr-negotiation.png",
    fullPage: true,
  });
  await dialog.getByRole('tab',{name:'Reviews & decision'}).click();
  await dialog.getByLabel('Candidate strengths').fill('Thoughtful communication and a clear motivation for the role');
  await dialog.getByLabel('Review reasons').fill('HR feedback is recorded after discussing expectations and fit');
  await dialog.getByRole('button',{name:'Submit review',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review submitted successfully'})).toBeVisible();
  await expect(page.getByText('Your HR interview feedback',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Interview view filter')).toContainText('Completed reviews');
});

test('managerial advancement remains discoverable until HR is scheduled', async ({page,browser})=>{
  await login(page, 'managerial_interviewer@example.com');
  await page.getByRole('combobox',{name:'Interview view filter'}).click();
  await page.getByRole('option',{name:'Pending reviews',exact:true}).click();
  await page.getByRole('article').filter({hasText:'Interview Candidate 2'}).getByRole('button',{name:'View candidate & review'}).click();
  await page.getByRole('tab',{name:'Reviews & decision'}).click();
  await page.getByLabel('Candidate strengths').fill('Strong leadership and ownership demonstrated');
  await page.getByLabel('Review reasons').fill('Ready for the HR discussion after managerial review');
  await page.getByRole('button',{name:'Submit review',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review submitted successfully'})).toBeVisible();
  await expect(page.getByText('Congratulations, Srinivas!',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Interview view filter')).toContainText('Completed reviews');
  await page.getByRole('button',{name:'Continue to interviews'}).click();
  await expect(page.getByRole('heading',{name:'Review submitted successfully'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Managerial Interview Portal'})).toBeFocused();
  const context=await browser.newContext();
  try {
    const admin=await context.newPage();
    await login(admin);
    await admin.getByRole('button',{name:'Interviews',exact:true}).click();
    await admin.getByRole('combobox',{name:'Interview view filter'}).click();
    await admin.getByRole('option',{name:'HR interview scheduling pending',exact:true}).click();
    const card=admin.getByRole('article').filter({hasText:'Interview Candidate 2'});
    await expect(card).toBeVisible();
    await card.getByRole('button',{name:'View candidate & reviews'}).click();
    await expect(admin.getByRole('heading',{name:'Interview Candidate 2',exact:true})).toBeVisible();
    await admin.getByRole('tab',{name:'Reviews & decision'}).click();
    await expect(admin.getByText('Strong leadership and ownership demonstrated',{exact:false})).toBeVisible();
    await admin.getByRole('button',{name:'Back to interviews'}).click();
    await card.getByRole('button',{name:'Schedule HR interview'}).click();
    await expect(admin.getByRole('dialog').getByRole('combobox',{name:'Interview round'})).toHaveAttribute('value','hr');
    await expect(admin.getByLabel('Manual exception reason')).toHaveCount(0);
    await admin.screenshot({path:'test-results/recruitment/hr-handoff-scheduling.png',fullPage:true});
  } finally { await context.close(); }
});

test('recruiter compares the talent pool, reviews historical context and reuses the same candidate', async ({page})=>{
  await login(page);
  await page.getByRole('button',{name:'Intelligent talent pool',exact:true}).click();
  await page.getByLabel('Recruitment job scope').click();
  await page.getByRole('option',{name:'Recruitment Platform Engineer',exact:true}).click();
  await page.getByRole('button',{name:'Compare talent pool',exact:true}).click();
  const card=page.getByRole('article').filter({hasText:'Interview Candidate 6'});
  await expect(card).toBeVisible();
  await expect(card.getByText(/Local comparison/)).toBeVisible();
  await card.getByRole('button',{name:'Review history & reuse'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText('Strong Python service design',{exact:false})).toBeVisible();
  await expect(dialog.getByText('Joining availability did not match the earlier role',{exact:true})).toBeVisible();
  await dialog.getByLabel('Talent reuse reason').fill('Recruiter approved reconsideration after reviewing the previous journey');
  await dialog.getByRole('button',{name:'Add to this job for review'}).click();
  await expect(page.getByText(/Candidate is associated with this job at/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/recruitment/talent-mobile.png',fullPage:true});
});
