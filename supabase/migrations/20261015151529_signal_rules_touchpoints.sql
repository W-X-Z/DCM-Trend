-- 눈여겨볼 회사는 다가오는 접점(만기·풋·단기 차입)만 남긴다. 사건형 신호는 피드로 옮김.
update ref.signal_rules set is_active = false
where signal_key in ('weak_demand', 'restructure', 'distress', 'big_dilution', 'invest', 'cb_buyback', 'hybrid', 'first_issue');
