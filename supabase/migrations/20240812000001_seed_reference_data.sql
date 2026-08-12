-- GasTa reference data — DOE regions, fuel types, transport modes

insert into public.regions (code, name) values
  ('NCR', 'National Capital Region'),
  ('NORTH_LUZON', 'North Luzon'),
  ('SOUTH_LUZON', 'South Luzon'),
  ('VISAYAS', 'Visayas'),
  ('MINDANAO', 'Mindanao');

insert into public.fuel_types (code, name, sort_order) values
  ('RON_91', 'RON 91', 1),
  ('RON_95', 'RON 95', 2),
  ('RON_97', 'RON 97', 3),
  ('RON_100', 'RON 100', 4),
  ('DIESEL', 'Diesel', 5),
  ('DIESEL_PLUS', 'Diesel Plus', 6),
  ('KEROSENE', 'Kerosene', 7);

insert into public.transport_modes (code, name, description, sort_order) values
  ('OWN_VEHICLE', 'Own Vehicle', 'User registered vehicle using DOE bulletin fuel prices', 1),
  ('JEEPNEY', 'Jeepney', 'Public jeepney transport', 2),
  ('TRICYCLE', 'Tricycle', 'Motorized tricycle transport', 3),
  ('RIDE_HAILING', 'Ride-hailing', 'App-based ride-hailing service', 4),
  ('WALKING', 'Walking', 'Walking — no fuel cost', 5);
