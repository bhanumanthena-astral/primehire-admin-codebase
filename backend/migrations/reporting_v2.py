"""Reports catalog/version lookups; original report and interview data is retained."""
async def upgrade(db):
    for name,keys,options in [
        ('report_catalog',[('orgId',1),('reportId',1)],{'unique':True}),
        ('report_catalog',[('orgId',1),('applicationId',1),('updatedAt',-1)],{}),
        ('report_catalog',[('orgId',1),('jobId',1),('updatedAt',-1)],{}),
        ('report_versions',[('orgId',1),('reportId',1),('version',1)],{'unique':True}),
        ('report_summaries',[('orgId',1),('summaryId',1)],{'unique':True}),
        ('report_summaries',[('orgId',1),('applicationId',1),('summaryGeneratedAt',1)],{}),
    ]:
        await db[name].create_index(keys,**options)
