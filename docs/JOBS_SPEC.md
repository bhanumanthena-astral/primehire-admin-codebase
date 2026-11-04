MODULE 1 : JOBS 

1. Module Overview 

Item
Details
Module
Jobs / Job Requisition Management
Primary Users
Super Admin, HR Admin, Recruiter, Hiring Manager, Interviewer/Assignee, Read-only User
Objective
Enable HR teams to create, manage, publish, close and track job openings
Submodules
Create a Job, View All Jobs, Edit a Job, View Job Details

The Jobs module should support:
Create a new job
View all jobs
Search, filter and sort jobs
View job details
Edit an existing job
Manage job lifecycle/status
View applications associated with a job 
SUBMODULE 1: CREATE A JOB
1.1 Objective
Allow authorized users to create a new job requisition by entering the required job, hiring, assignment and description information.
1.2 Create Job - Field Specification 

Field
Type
Mandatory
Source
Editable
Validation / Business Rule
Company Name
Dropdown/Text
Yes
System/Admin
Yes
Valid company
Job ID
System Generated
Yes
System
No
Unique
Job Role
Text/Dropdown
Yes
User
Yes
Cannot be blank
Job Title
Text
Yes
User
Yes
Cannot be blank
Min Experience
Number
Yes
User
Yes
≥ 0
Max Experience
Number
Yes
User
Yes
≥ Min Experience
No. of Positions
Number
Yes
User
Yes
Positive integer
Keywords
Multi-value/Tags
Recommended
User
Yes
No duplicates
Department
Input
Yes
User
Yes
Valid department
Opened At
Date/Time
Yes
System/User
Controlled
Valid date
Closes At
Date/Time
Yes
User
Yes
Must be > Opened At
Assignee
User Dropdown
Yes
System/User
Yes
Active user only
Assignee Email
Auto-populated
Yes
System
No
Based on selected assignee
Job Description
Rich Text
Yes
User
Yes
Cannot be blank

Detailed Input Validation Matrix 
Field
Data Type
Mandatory
Min Length / Value
Max Length / Value
Allowed Input
Validation / Business Rule
Company Name
Dropdown/Text
Yes
2 chars
150 chars
Alphabets, numbers, spaces, &, ., -
Must match valid company if dropdown is used
Job ID
System Generated
Yes
—
—
System-generated format only
Unique; user cannot modify
Job Role
Text/Dropdown
Yes
2 chars
100 chars
Alphabets, numbers, spaces, -, /, &, .
Cannot be blank
Job Title
Text
Yes
2 chars
150 chars
Alphabets, numbers, spaces, -, /, &, .
Cannot be blank
Minimum Experience
Decimal Number / Dropdown
Yes
0
50 years*
Numeric; YY.MM format if dropdown is used
Must be ≥ 0
Maximum Experience
Decimal Number / Dropdown
Yes
0
50 years*
Numeric; YY.MM format if dropdown is used
Must be ≥ Minimum Experience
No. of Positions
Integer
Yes
1
1,000*
Whole numbers only
No decimals, negative numbers or zero
Keywords
Multi-value/Tags
Recommended
1 char/tag
50 chars/tag*
Alphanumeric + approved symbols
No duplicate keywords
Maximum Keywords
Integer Count
—
1
20*
—
Maximum number of keywords to be defined
Job Department
Input
Yes
—
—
Predefined values
Entry
Opened At
Date/Time
Yes
—
—
Valid date/time
Must follow system/org timezone
Closes At
Date/Time
Yes
—
—
Valid date/time
Must be later than Opened At
Assignee
Dropdown
Yes
—
—
Active system users
Inactive users cannot be newly assigned
Assignee Email
Auto-populated Email
Yes
—
254 chars
Valid email format
Derived from selected Assignee; not manually editable
Job Description
Rich Text
Yes
50 chars*
10,000 chars*
Text, bullets, headings, links, approved formatting
Cannot be blank; HTML

1.2.2 Character & Special Character Rules 
Input
Allowed
Not Allowed
Company Name
Letters, numbers, spaces, &, ., -
< > { } [ ] and scripts
Job Role
Letters, numbers, spaces, -, /, &, .
HTML/script
Job Title
Letters, numbers, spaces, -, /, &, .
HTML/script
Keywords
Letters, numbers, +, #, ., -
HTML/script
Assignee Email
Standard email characters
Spaces/invalid email syntax
Job Description
Rich text + approved formatting
Executable scripts / unsafe HTML


1.3 Job ID
The system must automatically generate the Job ID.
Rules
Job ID must be unique across the system.
User cannot manually modify the Job ID.
Editing an existing job must not generate a new Job ID.
Deleted/archived jobs must not result in Job ID reuse.
1.4 Experience Validation
The system should support:
Drop down of min. YY.MM and max. Experience of max in this format YY.MM - decimal values
Decimal values such as 2.5 years
The system must prevent submission when the maximum experience is less than the minimum experience. Maximum Experience >= Minimum Experience
1.5 Number of Positions
The No. of Positions field should accept only positive integers.
Field
Value
Positions
5
Filled
5
Remaining
0

1.6 Keywords
Keywords should preferably use a multi-select/tag input.
Rules
Duplicate keywords should not be allowed.
Extra spaces should be trimmed.
Case normalization should be considered.
Maximum keyword count should be defined.
1.7 Job Dates
Opened At
Date can be selected through a calendar.
Source allows this to be system/user controlled.
Closes At
The closing date must be greater than the opening date.
Closing date equal to opening date should be prevented unless explicitly permitted by the business.
If the job is closed, the system should display:
“This job should no longer accept applications.”
1.8 Job Status
The job lifecycle should support the following statuses:
Status
Accept Applications
Editable
Visible in Active Jobs
Draft
No
Yes
No
Open
Yes
Yes*
Yes
On Hold
No
Yes
No / Separate
Closed
No
Limited
No
Archived
No
No / Restricted
No




1.9 Job Description
The Job Description should consists of :
The system should define:
Maximum character limit
Minimum character limit
Supported formatting
Copy/paste behavior
Links
Bullets
Headings
Special characters


1.9.1 JD Upload
The system should allow the user to upload an existing Job Description (JD) document while creating a job.
Supported Upload
Requirement
Specification
Upload Type
File upload
Purpose
Populate job information from an existing JD
Mandatory
Optional
Supported Formats
To be confirmed
Maximum File Size
To be defined
Multiple Files
Single JD per job
Processing
Extract JD content and map relevant information
User Action
Upload → Extract → Review → Save

1.9.2 JD Template
JD Template Fields
The template should include:
Field
Mandatory
Input Type / Format
Company Name
Yes
Text / predefined
Job Role
Yes
Text
Job Title
Yes
Text
Minimum Experience
Yes
Number
Maximum Experience
Yes
Number
Number of Positions
Yes
Positive Integer
Keywords
Recommended
Comma-separated / tags
Department
Yes
Text / predefined
Opened At
Yes
Date & Time
Closes At
Yes
Date & Time
Assignee
Yes
User
Work Mode
Yes
Remote / Hybrid / On-site
Location
If applicable
Text
Job Description
Yes
Text

Upload Completed JD Template
After completing the template, the user can select:
“Upload JD”
The system should accept only the prescribed JD template format.
1.9.3 Upload Validation
The system should validate:
File format
File size
Template structure
Mandatory fields
Valid field values
Experience range
Number of positions
Opening and closing dates
Duplicate keywords
Assignee validity
1.9.4 Template Validation
If the user uploads an incorrect or modified template:
Invalid JD template. Please download the latest template and upload the completed template.
If mandatory information is missing:
Please complete all mandatory fields before uploading the JD.
The system should identify the relevant field wherever possible.
1.10 Duplicate Job Validation
When a user attempts to create a job similar to an existing job, the system should identify the potential duplicate.
Possible approach
Duplicate detection may consider:
Company
Job Role
Department
Location
Status
JD
The current source proposes either:
Option A - Warning
A similar job already exists. Do you want to continue?
or
Option B - Prevent duplicate
The exact approach needs product/business confirmation.
1.11 Save / Cancel Behavior
Successful Creation
Display: Job created successfully.
Cancel - No Changes
Return the user to the Jobs list.
Cancel - Unsaved Changes
Display: You have unsaved changes. Are you sure you want to leave?
Actions:
Stay
Discard Changes

SUBMODULE 2: VIEW ALL JOBS
2.1 Objective
Allow authorized users to view and manage all jobs from a centralized Jobs listing.
2.2 Jobs Listing
The Jobs table should display:
Column
Purpose
Job ID
Job identification
Job Title
Job identification
Job Role
Role
Company
Company
Department
Department
Experience
Requirement
Positions
Hiring requirement
Applications
Candidate volume
Assignee
Ownership
Opened At
Timeline
Closes At
Deadline
Status
Lifecycle
Actions
Job management


2.3 Search
Users should be able to search using:
Job ID
Job Title
Job Role
Company
Assignee
Search should support:
Exact match
Partial match
Case-insensitive search
Starts with
Contains
2.4 Filters
Available filters:
Status
Company
Department
Assignee
Experience
Work Mode
Opened Date
Closing Date
2.5 Pagination
Default pagination: 20 jobs per page. 
2.6 Empty States
2.6.1 No search/filter results
No jobs found.
2.6.2 No jobs created
You haven't created any jobs yet. Create your first job to start receiving applications.

2.7 Actions
Actions available from the Jobs listing should be controlled by the user's permissions and job status.
Actions should include:
View
Edit
Close
Archive
Assign/Reassign


SUBMODULE 3: VIEW JOB DETAILS

3.1 Objective
Allow users to view the complete information associated with a particular job.
3.2 Job Information
The Job Details page should display:
Company Name
Job ID
Job Role
Job Title
Department
Experience
No. of Positions
Keywords
Work Mode
Location


3.3 Job Description
Display the complete Job Description using the formatting stored during job creation.

SUBMODULE 4: EDIT A JOB
4.1 Objective
Allow authorized users to modify permitted information of an existing job without changing its Job ID.
4.2 Editable Fields
The current source explicitly allows editing of:
Job Description
Keywords
Assignee
Closing Date
Number of Positions
4.3 Non-Editable Fields
The following cannot be edited:
Job ID
Company
Job Role
5. JOB ACTIVITY / HISTORY
Activity history should be associated with the Job Details page.
Example:
Date/Time
Activity
03-Oct-2026 02:30 PM
Job created by Srivani
03-Oct-2026 03:10 PM
Assignee changed from Rahul to Priya
04-Oct-2026 11:20 AM
Closing date changed
05-Oct-2026 04:15 PM
Job description updated

The system should capture:
Who performed the action
What changed
Old value
New value
Date/time
This is effectively an audit trail and should not be confused with the application's user-facing status history.
6. ASSIGNEE MANAGEMENT
6.1 Single Assignee
Current model: Job → One HR Owner
6.2 Multiple Assignees
The source also considers:
Job → HR 1 → HR 2 → Recruiter 3
If multiple assignees are supported, the system must define:
Primary Assignee
Secondary Assignees
Notifications
Permissions
Option 1: One assignee per job
or
Option 2: Multiple assignees with one primary owner.
7. ASSIGNEE DEACTIVATION / REASSIGNMENT
If the assigned HR user:
Leaves the organization
Changes department
Has their account deleted/deactivated
the system should:
Preserve the historical assignee information.
Prevent loss of audit history.
Allow an authorized admin to reassign the job.
8. NOTIFICATIONS
Job Assignment
When a job is assigned: Notify assignee.
Assignment Change
When the assignment changes: Notify new assignee.
The exact notification channel-application notification, email, or both-is not specified in the source and should be confirmed.
9. JOB CLOSURE
9.1 Manual Closure
HR selects:
Close Job
Confirmation: “ Are you sure you want to close this job? New applications will no longer be accepted.”
After closure:
Jobs must stop accepting new applications.
Status becomes Closed.
Jobs should no longer appear under active jobs.
9.2 Automatic Closure
At the configured closing date/time, the system should automatically close the job.
The source specifies automatic closure but does not define the exact scheduler/time-zone implementation. The organization timezone should be used for closing-date/time interpretation.  
10. REOPEN CLOSED JOB
A closed job may be reopened subject to:
Appropriate authorization
A valid future closing date/time
The source specifically identifies "Closed job reopened → Require valid closing date." 
11. DELETE / ARCHIVE JOB
If no applications exist
The system may allow:
Delete
Archive
If applications exist
The preferred behavior is:
Archive
12. ROLE-BASED PERMISSIONS
Action
Admin
HR Manager
Recruiter
Viewer
Create Job
✓
✓
✓
No
View Job
✓
✓
✓
✓
Edit Job
✓
✓
✓
No
Close Job
✓
✓
✓
No
Archive
✓
✓
Maybe
No
Assign Job
✓
✓
Maybe
No


13. EDGE CASES & SYSTEM BEHAVIOR
Scenario
Expected Behavior
Mandatory field empty
Show validation
Min Experience > Max Experience
Prevent submission
Negative experience
Prevent
Decimal positions
Prevent
Positions = 0
Prevent
Duplicate keyword
Prevent/merge
Closing Date < Opening Date
Prevent
Closing Date = Opening Date
Prevent unless permitted
Invalid Assignee
Prevent
Inactive Assignee
Do not allow new assignment
Assignee email changes
Auto-update
Duplicate Job
Warn user
Unsaved changes + cancel
Show confirmation
Job ID manually modified
Prevent
Invalid Job ID
Show not found
No jobs
Empty state
Search returns nothing
No-results state
Filter returns nothing
No-results state
Job has applications
Show application count
Job closes
Stop new applications
Closed job edited
Apply status-based restrictions
Closed job reopened
Require valid closing date
Job has applications + delete
Prevent hard deletion / archive
Assignee deactivated
Preserve history + provide reassignment
Concurrent editing
Detect conflict
Unauthorized access
Access denied
API failure during save
Show error without losing entered data
Network failure
Preserve form where possible
Browser refresh during creation
Warn about unsaved data
Duplicate submission
Prevent duplicate creation
Session expires during editing
Handle gracefully
Very long description
Enforce character limit
Closing timezone difference
Use organization timezone


